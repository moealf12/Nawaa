"""Authenticated, fail-closed remote adapter for the existing NAWAA Noon UAE worker.

Only one fixed source/query operation is exposed. No URL input, open proxy,
catalog writes, currency conversion, retries, or user-facing price claims.
"""
import hmac
import json
import os
import re
import subprocess
import sys
import threading
import time
from typing import Literal

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA = "nawaa.noon.ae.cards.v1"
MAX_OUTPUT_BYTES = 512_000
DENIAL_COOLDOWN_SECONDS = 900
_lock = threading.Lock()
_denied_until = 0.0

app = FastAPI(
    title="NAWAA private Noon AE acquisition",
    docs_url=None, redoc_url=None, openapi_url=None,
)

class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schemaVersion: Literal["nawaa.noon.ae.cards.v1"]
    requestId: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    sourceId: Literal["noon-ae"]
    query: str = Field(min_length=2, max_length=120)
    budgetMs: int = Field(default=5300, ge=1500, le=5300)

    @field_validator("query")
    @classmethod
    def no_control_characters(cls, value: str) -> str:
        if re.search(r"[\x00-\x1f\x7f]", value):
            raise ValueError("invalid query characters")
        return value

@app.get("/health")
def health():
    return {"status": "ok", "service": "nawaa-noon-ae", "schemaVersion": SCHEMA}

def require_auth(header: str | None):
    secret = os.environ.get("NAWAA_ORACLE_SHARED_TOKEN", "")
    if len(secret) < 32:
        raise HTTPException(status_code=503, detail="SERVICE_NOT_CONFIGURED")
    expected = "Bearer " + secret
    if not header or len(header) > 512 or not hmac.compare_digest(header, expected):
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")

@app.post("/v1/noon-ae/search")
def search(payload: SearchRequest, authorization: str | None = Header(default=None)):
    global _denied_until
    require_auth(authorization)
    if time.monotonic() < _denied_until:
        return JSONResponse(status_code=503, content={
            "schemaVersion": SCHEMA, "sourceId": "noon-ae",
            "requestId": payload.requestId, "status": "ERROR",
            "errorCode": "SOURCE_ACCESS_DENIED_COOLDOWN",
        }, headers={"Retry-After": "900"})
    if not _lock.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="SOURCE_BUSY")
    try:
        packet = payload.model_dump()
        safe_env = {k: v for k, v in os.environ.items()
                    if k in ("PATH", "HOME", "LANG", "LC_ALL", "PYTHONPATH", "PYTHONDONTWRITEBYTECODE")}
        safe_env["PYTHONDONTWRITEBYTECODE"] = "1"
        try:
            process = subprocess.run(
                [sys.executable, "-m", "nawaa_py.noon_ae_search"],
                input=json.dumps(packet, ensure_ascii=False) + "\n",
                capture_output=True, text=True,
                timeout=(payload.budgetMs + 1000) / 1000,
                env=safe_env,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="SOURCE_DEADLINE_EXCEEDED") from None
        except OSError:
            raise HTTPException(status_code=503, detail="WORKER_UNAVAILABLE") from None
        if process.returncode or len(process.stdout.encode("utf-8")) > MAX_OUTPUT_BYTES:
            raise HTTPException(status_code=502, detail="WORKER_INVALID_OUTPUT")
        lines = process.stdout.strip().splitlines()
        if len(lines) != 1:
            raise HTTPException(status_code=502, detail="WORKER_INVALID_JSONL")
        try:
            result = json.loads(lines[0])
        except (ValueError, TypeError):
            raise HTTPException(status_code=502, detail="WORKER_INVALID_JSON") from None
        if (not isinstance(result, dict)
            or result.get("schemaVersion") != SCHEMA
            or result.get("sourceId") != "noon-ae"
            or result.get("requestId") != payload.requestId
            or result.get("status") not in ("OK", "ERROR")):
            raise HTTPException(status_code=502, detail="WORKER_CONTRACT_MISMATCH")
        if result["status"] == "ERROR":
            if result.get("errorCode") in ("HTTP_403_ACCESS_DENIED", "HTTP_429_RATE_LIMITED"):
                _denied_until = time.monotonic() + DENIAL_COOLDOWN_SECONDS
                return JSONResponse(status_code=503, content=result,
                                    headers={"Retry-After": "900"})
            return JSONResponse(status_code=502, content=result)
        if not isinstance(result.get("cards"), list):
            raise HTTPException(status_code=502, detail="WORKER_CARDS_INVALID")
        return result
    finally:
        _lock.release()
