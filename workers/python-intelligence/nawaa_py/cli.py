"""Bounded JSONL worker: stdin/stdout data only; stderr never leaks source details."""
import asyncio
import json
import re
import sys
from pydantic import ValidationError
from .contracts import (
    VERSION, ErrorResponse, ExtractionRequest, ExtractionResponse,
    IdentityResult, ProductExpectation
)
from .html_extract import extract_html
from .prices import parse_price
from .transport import FetchFailure, fetch_public_html
from .variants import VariantClassifier

MAX_LINE_BYTES = 2_200_000
MAX_MESSAGES = 32
_SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_SAFE_SOURCE = re.compile(r"^[a-z0-9][a-z0-9-]{1,79}$")

async def process(payload: dict) -> dict:
    request = ExtractionRequest.model_validate(payload)
    data = request.input_data
    product: ProductExpectation | None
    evidence = None
    diagnostic = "CLASSIFICATION_ONLY"
    if request.operation == "classify":
        product = data.observed
        if data.price is not None or data.currency is not None:
            evidence = parse_price(data.price, data.currency)
    else:
        if request.operation in ("extract_html", "extract_and_classify"):
            if data.html is not None:
                html = data.html
            elif data.url is not None:
                html = await fetch_public_html(
                    data.url, request.source_id, request.limits.timeoutMs,
                    request.limits.maxResponseBytes
                )
            else:
                raise ValueError("HTML_OR_URL_REQUIRED")
        elif request.operation == "fetch_extract":
            html = await fetch_public_html(
                data.url, request.source_id, request.limits.timeoutMs,
                request.limits.maxResponseBytes
            )
        else:
            raise ValueError("OPERATION_UNSUPPORTED")
        product, evidence, diagnostic = extract_html(html, data.expected)
    identity: IdentityResult = VariantClassifier.classify(
        data.expected, product or ProductExpectation()
    )
    status = ("CLASSIFIED" if request.operation == "classify" else
              "EXTRACTED" if product is not None and evidence is not None else "NO_OFFER")
    return ExtractionResponse(
        requestId=request.request_id, sourceId=request.source_id,
        status=status, product=product, offerEvidence=evidence,
        identity=identity, diagnostics={"code": diagnostic},
    ).model_dump(mode="json", by_alias=True)

def _safe_identity(raw: object) -> tuple[str, str]:
    if not isinstance(raw, dict):
        return "unknown", "unknown"
    rid, sid = raw.get("requestId"), raw.get("sourceId")
    return (
        rid if isinstance(rid, str) and _SAFE_ID.fullmatch(rid) else "unknown",
        sid if isinstance(sid, str) and _SAFE_SOURCE.fullmatch(sid) else "unknown",
    )

def _error(raw: object, code: str) -> dict:
    rid, sid = _safe_identity(raw)
    return ErrorResponse(requestId=rid, sourceId=sid, errorCode=code).model_dump(
        mode="json", by_alias=True
    )

def run_worker() -> int:
    for _ in range(MAX_MESSAGES):
        raw = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
        if not raw:
            return 0
        if len(raw) > MAX_LINE_BYTES or not raw.endswith(b"\n"):
            sys.stdout.write(json.dumps(_error({}, "INPUT_TOO_LARGE_OR_UNFRAMED")) + "\n")
            sys.stdout.flush()
            return 2
        parsed = None
        try:
            parsed = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            result = asyncio.run(process(parsed))
        except (ValidationError, ValueError, TypeError, UnicodeError, json.JSONDecodeError):
            result = _error(locals().get("parsed"), "INPUT_OR_EVIDENCE_INVALID")
        except FetchFailure as exc:
            result = _error(locals().get("parsed"), exc.code)
        except Exception:
            # Deliberately do not leak merchant URLs, headers, HTML or traceback.
            result = _error(locals().get("parsed"), "WORKER_INTERNAL_FAILURE")
        sys.stdout.write(json.dumps(result, separators=(",", ":"), ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0

if __name__ == "__main__":
    raise SystemExit(run_worker())
