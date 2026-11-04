#!/usr/bin/env python3
"""One real first-party Noon Saudi search with curl_cffi.
Isolated acceptance probe. No proxy, retries, stored cookies, synthetic offers,
raw HTML logs, customer publication or production writes.
"""
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse

from curl_cffi import requests

QUERY = "iPhone 17 256GB"
URL = "https://www.noon.com/saudi-en/search/?" + urlencode({"q": QUERY})
OUT = "noon-sa-curl-transport.json"
CAP = 8_000_000


def category(error):
    message = str(error)
    for term in ("SSL", "CERT", "HTTP2", "HTTP3", "TIMEOUT", "CONNECT", "DNS"):
        if term.lower() in message.lower():
            return "TRANSPORT_" + term
    return "TRANSPORT_OTHER"


report = {
    "schema": "nawaa.noon-sa.curl-live.v1",
    "observedAt": datetime.now(timezone.utc).isoformat(),
    "testedHeadSha": os.getenv("PULL_REQUEST_HEAD_SHA"),
    "query": QUERY,
    "transport": "curl_cffi_chrome",
    "liveOnly": True,
    "requests": 0,
    "customerPublishable": False,
    "pdpVerified": False,
    "proxies": False,
    "state": "NOT_RUN",
}
t0 = time.monotonic()
try:
    response = requests.get(
        URL, impersonate="chrome", timeout=12, allow_redirects=False,
        headers={"Accept": "text/html,application/xhtml+xml",
                 "Accept-Language": "en-SA,en;q=0.9,ar-SA;q=0.8"},
    )
    report["requests"] = 1
    report["httpStatus"] = response.status_code
    report["state"] = (
        "ACCESS_DENIED" if response.status_code == 403 else
        "RATE_LIMITED" if response.status_code == 429 else
        "REDIRECT" if response.status_code in range(300, 400) else
        "HTTP_FAILED" if response.status_code != 200 else
        "HTTP_OK"
    )
    origin = urlparse(str(response.url))
    if origin.scheme != "https" or origin.hostname != "www.noon.com":
        report["state"] = "UNEXPECTED_ORIGIN"
    elif report["state"] == "HTTP_OK":
        if "text/html" not in response.headers.get("content-type", "").lower():
            report["state"] = "NON_HTML_RESPONSE"
        elif len(response.content) > CAP:
            report["state"] = "RESPONSE_TOO_LARGE"
        else:
            parsed = subprocess.run(
                ["node", "scripts/noon-sa-curl-evidence.mjs"],
                input=response.content, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, timeout=8, check=False,
            )
            try:
                report["evidence"] = json.loads(parsed.stdout.decode("utf-8"))
                report["state"] = report["evidence"].get("state", "PARSER_FAILED")
            except (ValueError, UnicodeDecodeError):
                report["state"] = "PARSER_FAILED"
except Exception as exc:
    report["state"] = category(exc)
finally:
    report["elapsedMs"] = round((time.monotonic()-t0)*1000)
    with open(OUT, "w", encoding="utf8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(json.dumps(report, indent=2))
    if report["state"] != "SOURCE_PRICE_EVIDENCE_OBSERVED":
        raise SystemExit(1)
