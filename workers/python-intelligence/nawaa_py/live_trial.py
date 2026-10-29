"""Single genuine Python HTTP experiment; never asserts a merchant offer exists."""
import asyncio
import json
import os
from .contracts import VERSION
from .cli import process
from .transport import FetchFailure

# An existing public retailer. No proxies, impersonated browser or retries.
SOURCE_ID = "jarir-sa"
URL = "https://www.jarir.com/sa-en/"

async def run():
    payload = {
        "schemaVersion": VERSION, "requestId": "python-live-jarir-001",
        "sourceId": SOURCE_ID, "operation": "fetch_extract",
        "input": {"url": URL, "expected": {"brand": "Apple", "model": "iPhone 17", "storageGb": 256}},
        "limits": {"timeoutMs": 7000, "maxResponseBytes": 1_000_000}
    }
    try:
        result = await process(payload)
        summary = {
            "experiment": "PYTHON_HTTPX_REAL_SOURCE",
            "sourceId": SOURCE_ID, "outcome": result["status"],
            "identity": result["identity"]["decision"],
            "hasPriceEvidence": result["offerEvidence"] is not None,
            "diagnostic": result["diagnostics"]["code"],
            "noProxy": True, "noRetries": True
        }
    except FetchFailure as error:
        summary = {
            "experiment": "PYTHON_HTTPX_REAL_SOURCE",
            "sourceId": SOURCE_ID, "outcome": "ACCESS_OR_TRANSPORT_NOT_AVAILABLE",
            "failureClass": error.code,
            "hasPriceEvidence": False, "noProxy": True, "noRetries": True
        }
    print("NAWAA_PYTHON_REAL_TRIAL " + json.dumps(summary, separators=(",", ":")))

if __name__ == "__main__":
    if os.getenv("NAWAA_PY_LIVE_ENABLED") != "1":
        raise SystemExit("NAWAA_PY_LIVE_ENABLED_REQUIRED")
    asyncio.run(run())
