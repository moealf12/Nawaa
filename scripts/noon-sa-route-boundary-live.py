#!/usr/bin/env python3
"""Bounded public-only Noon Saudi route differential; diagnostics, no publishing.

UAE success is the negative control. Saudi homepage and category tell whether
Saudi search refusal is specific to the search path or the Saudi storefront.
No proxies, retries, auth, WAF challenges, merchant data writes, or raw HTML logs.
"""
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests

BASE = "https://www.noon.com"
TARGETS = (
    ("AE_warmup_control", "/uae-en/"),
    ("SA_home", "/saudi-en/"),
    ("SA_public_category", "/saudi-en/electronics-and-mobiles/"),
)
REPORT = {
    "schema": "nawaa.noon-sa.route-boundary.v1",
    "headSha": os.environ.get("PULL_REQUEST_HEAD_SHA", ""),
    "observedUtc": datetime.now(timezone.utc).isoformat(),
    "market": "SA",
    "noProxy": True,
    "noRetry": True,
    "customerPublishable": False,
    "pdpVerified": False,
    "attempted": 0,
    "results": [],
    "decision": "NOT_RUN",
}

def classify(error):
    kind = type(error).__name__
    msg = str(error).lower()
    if kind in ("TypeError", "NameError", "AttributeError"):
        return "CODE_FAILURE"
    if "timeout" in kind.lower() or "timeout" in msg or "timed out" in msg:
        return "TIMEOUT"
    if "http2" in msg or "http/2" in msg:
        return "HTTP2_FAILURE"
    return "NETWORK_EXCEPTION"

try:
    with requests.Session(impersonate="chrome") as session:
        for label, path in TARGETS:
            start = time.monotonic()
            item = {"stage": label, "path": path}
            REPORT["attempted"] += 1
            try:
                response = session.get(
                    BASE + path, timeout=12, allow_redirects=False,
                    headers={"accept": "text/html,application/xhtml+xml",
                             "accept-language": "en-SA,en;q=0.9"},
                )
                item["status"] = response.status_code
                item["httpVersion"] = str(response.http_version)[:20]
                item["contentType"] = str(
                    response.headers.get("content-type") or "")[:80]
                item["bodyBytes"] = len(response.content)
                u = urlsplit(str(response.url))
                item["originValid"] = (u.scheme == "https"
                                       and u.hostname == "www.noon.com")
                if 300 <= response.status_code < 400:
                    target = response.headers.get("location", "")
                    if target:
                        next_url = urlsplit(target)
                        item["relativeRedirect"] = not next_url.netloc
                        item["redirectPath"] = next_url.path[:120]
                if (response.status_code == 200
                        and item["originValid"] and len(response.content) <= 5_000_000
                        and "html" in item["contentType"].lower()):
                    item["bodySha256"] = hashlib.sha256(response.content).hexdigest()
                    soup = BeautifulSoup(response.content, "html.parser")
                    item["documentLanguage"] = (
                        str(soup.html.get("lang") or "")[:30]
                        if soup.html else "")
                    item["productLikeAnchors"] = min(
                        1000, len(soup.select('a[href*="/p/"]')))
                    item["state"] = "LIVE_HTML_RECEIVED_UNVERIFIED_PRODUCT_SOURCE"
                elif response.status_code == 403:
                    item["state"] = "HTTP_403"
                elif response.status_code == 429:
                    item["state"] = "HTTP_429"
                else:
                    item["state"] = "HTTP_" + str(response.status_code)
            except Exception as exc:
                item["state"] = classify(exc)
                item["exceptionType"] = type(exc).__name__[:50]
            finally:
                item["elapsedMs"] = round(
                    (time.monotonic() - start) * 1000)
                REPORT["results"].append(item)
        sa = REPORT["results"][1:]
        REPORT["decision"] = (
            "SAUDI_PUBLIC_HTML_RECEIVED_NO_PRICE_VERIFICATION"
            if any(x["state"] == "LIVE_HTML_RECEIVED_UNVERIFIED_PRODUCT_SOURCE"
                   and x.get("documentLanguage", "").lower() in ("en-sa", "ar-sa")
                   for x in sa)
            else "SAUDI_PUBLIC_ROUTES_NOT_VERIFIED"
        )
except Exception as exc:
    REPORT["decision"] = classify(exc)
finally:
    with open("noon-sa-route-boundary-live.json", "w", encoding="utf-8") as out:
        json.dump(REPORT, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(json.dumps(REPORT, ensure_ascii=False, indent=2))
    if REPORT["decision"] != "SAUDI_PUBLIC_HTML_RECEIVED_NO_PRICE_VERIFICATION":
        raise SystemExit(1)
