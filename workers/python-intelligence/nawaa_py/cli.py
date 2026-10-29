"""One bounded JSON input line, one JSON output line; no HTTP in P1."""
import json
import sys
from .identity import classify
from .prices import normalize_price

VERSION = "nawaa.python.classify.v1"
MAX_BYTES = 65536


def process(request: dict) -> dict:
    if not isinstance(request, dict) or request.get("schemaVersion") != VERSION:
        raise ValueError("SCHEMA_VERSION_INVALID")
    rid = request.get("requestId")
    if not isinstance(rid, str) or not (1 <= len(rid) <= 128):
        raise ValueError("REQUEST_ID_INVALID")
    if request.get("operation") != "classify":
        raise ValueError("OPERATION_UNSUPPORTED")
    expected, observed = request.get("expected"), request.get("observed")
    if not isinstance(expected, dict) or not isinstance(observed, dict):
        raise ValueError("IDENTITY_INPUT_INVALID")
    identity = classify(expected, observed)
    result = {"schemaVersion": VERSION, "requestId": rid,
              "status": "CLASSIFIED", "identity": identity}
    if "price" in request or "currency" in request:
        result["priceEvidence"] = normalize_price(request.get("price"), request.get("currency"))
    return result


def main() -> int:
    raw = sys.stdin.buffer.readline(MAX_BYTES + 1)
    if not raw or len(raw) > MAX_BYTES or not raw.endswith(b"\\n"):
        print(json.dumps({"error": "INPUT_SIZE_OR_FRAMING_INVALID"}), file=sys.stderr)
        return 2
    try:
        request = json.loads(raw)
        result = process(request)
    except (ValueError, TypeError, json.JSONDecodeError):
        print(json.dumps({"error": "INPUT_VALIDATION_FAILED"}), file=sys.stderr)
        return 2
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
