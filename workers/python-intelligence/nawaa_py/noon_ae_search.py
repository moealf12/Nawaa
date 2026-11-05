"""Bounded public Noon UAE search transport, run only by the NAWAA Node bridge.

Accepts one fixed-schema JSON line, fetches the UAE home page and exactly one
query-bound /uae-en/search/ page using the experimental PR #310 transport.
Never accepts arbitrary URLs, follows a redirect, retries, accesses APIs or
touches production data. All product admission and SAR FX remain in Node.
"""
from __future__ import annotations
import json
import re
import sys
import time
from urllib.parse import urlencode, urlsplit

SCHEMA = "nawaa.noon.ae.html.v1"
SOURCE = "noon-ae"
MAX_INPUT = 1300
MAX_HTML = 3_000_000
MAX_QUERY = 120
ORIGIN = "https://www.noon.com"
MAX_NETWORK_MS = 5600
REQUEST_ID = re.compile(r"^[0-9a-f-]{36}$")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def request_url(query: str) -> str:
    if not isinstance(query, str) or not (2 <= len(query) <= MAX_QUERY):
        raise ValueError("INVALID_QUERY")
    if CONTROL.search(query):
        raise ValueError("INVALID_QUERY")
    return ORIGIN + "/uae-en/search/?" + urlencode({"q": query})


def attested_result(response, expected_url: str) -> tuple[str, str]:
    """Return source HTML only for the exact first-party URL and HTML HTTP 200."""
    from_url = str(response.url)
    got, expected = urlsplit(from_url), urlsplit(expected_url)
    if (got.scheme != "https" or got.netloc != "www.noon.com"
            or got.username or got.password
            or got.path.rstrip("/") != expected.path.rstrip("/")
            or got.query != expected.query or got.fragment):
        raise ValueError("SOURCE_SEARCH_URL_MISMATCH")
    status = int(response.status_code)
    if status == 403:
        raise ValueError("HTTP_403_ACCESS_DENIED")
    if status == 429:
        raise ValueError("HTTP_429_RATE_LIMITED")
    if status != 200:
        raise ValueError("SOURCE_HTTP_FAILURE")
    ctype = str(response.headers.get("content-type", "")).lower()
    if "text/html" not in ctype and "application/xhtml+xml" not in ctype:
        raise ValueError("NON_HTML_RESPONSE")
    if len(response.content) > MAX_HTML:
        raise ValueError("RESPONSE_TOO_LARGE")
    return response.content.decode("utf-8", errors="replace"), from_url


def collect(query: str, budget_ms: int) -> tuple[str, str]:
    # Lazy import permits deterministic offline unit tests without a network.
    from curl_cffi import requests

    target = request_url(query)
    started = time.monotonic()
    max_s = min(budget_ms, MAX_NETWORK_MS) / 1000
    with requests.Session(impersonate="chrome") as session:
        for url in (ORIGIN + "/uae-en/", target):
            remaining = max_s - (time.monotonic() - started)
            if remaining < 0.25:
                raise ValueError("SOURCE_HTTP_TIMEOUT")
            try:
                response = session.get(
                    url, timeout=min(remaining, 3.2), allow_redirects=False,
                    headers={"accept": "text/html,application/xhtml+xml"},
                )
            except Exception:
                raise ValueError("SOURCE_TRANSPORT_FAILURE") from None
            if url != target:
                if response.status_code == 403:
                    raise ValueError("HTTP_403_ACCESS_DENIED")
                if response.status_code == 429:
                    raise ValueError("HTTP_429_RATE_LIMITED")
                if response.status_code != 200 or urlsplit(str(response.url)).netloc != "www.noon.com":
                    raise ValueError("SOURCE_WARMUP_UNAVAILABLE")
                continue
            return attested_result(response, target)
    raise ValueError("SOURCE_HTML_UNAVAILABLE")


def respond(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    request_id = None
    try:
        line = sys.stdin.buffer.readline(MAX_INPUT + 1)
        if len(line) > MAX_INPUT or not line.endswith(b"\n"):
            raise ValueError("INVALID_INPUT")
        packet = json.loads(line)
        if not isinstance(packet, dict) or set(packet) != {
            "schemaVersion", "requestId", "sourceId", "query", "budgetMs"
        }:
            raise ValueError("INVALID_INPUT")
        request_id = packet["requestId"]
        if (packet["schemaVersion"] != SCHEMA or packet["sourceId"] != SOURCE
                or not isinstance(request_id, str)
                or not REQUEST_ID.fullmatch(request_id)
                or type(packet["budgetMs"]) is not int
                or not (1500 <= packet["budgetMs"] <= MAX_NETWORK_MS)):
            raise ValueError("INVALID_INPUT")
        html, final_url = collect(packet["query"], packet["budgetMs"])
        respond({"schemaVersion": SCHEMA, "sourceId": SOURCE,
                 "requestId": request_id, "status": "OK",
                 "finalUrl": final_url, "html": html})
    except Exception as exc:
        # No exception strings, request URL, cookies or raw HTML in logs.
        code = str(exc) if isinstance(exc, ValueError) else "SOURCE_TRANSPORT_FAILURE"
        if not re.fullmatch(r"[A-Z0-9_]{3,70}", code):
            code = "SOURCE_TRANSPORT_FAILURE"
        respond({"schemaVersion": SCHEMA, "sourceId": SOURCE,
                 "requestId": request_id, "status": "ERROR",
                 "errorCode": code})
    return 0


if __name__ == "__main__":
    sys.exit(main())
