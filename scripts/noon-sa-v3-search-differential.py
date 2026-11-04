#!/usr/bin/env python3
"""Live one-shot hypothesis test for Noon Saudi's /api/v3/search transport.
Staging only: user reports merchant authorization; no proxy, no retries, no
customer/catalog writes, no unknown-market SAR publication.
Based on independently documented endpoint differences, NOT an official API.
"""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

from curl_cffi import requests

ORIGIN = "https://www.noon.com"
WARMUP = ORIGIN + "/uae-en/"
SEARCH = (
    ORIGIN
    + "/_vs/nc/mp-customer-catalog-api/api/v3/search?"
    + urlencode({"q": "iPhone 17 256GB", "limit": "12"})
)
MAX_BODY_BYTES = 2_000_000
OUTPUT = "noon-sa-v3-search-differential.json"

report = {
    "schema": "nawaa.noon-sa.v3-search-differential.v1",
    "testedHeadSha": os.getenv("PULL_REQUEST_HEAD_SHA"),
    "observedAt": datetime.now(timezone.utc).isoformat(),
    "query": "iPhone 17 256GB",
    "transport": "single_curl_cffi_session_chrome",
    "source": "noon-sa",
    "endpoints": {
        "warmup": "/uae-en/",
        "search": "/_vs/nc/mp-customer-catalog-api/api/v3/search",
    },
    "requestCount": 0,
    "retries": 0,
    "proxies": False,
    "sourceCountryClaim": "sa",
    "countryVerifiedIndependently": False,
    "customerPublishable": False,
    "checkoutVerified": False,
    "pdpVerified": False,
    "observations": [],
    "conclusion": "NOT_RUN",
}


def safe_headers(response):
    """Observability without recording cookies, tokens, full header or body."""
    headers = response.headers
    return {
        "contentType": str(headers.get("content-type") or "")[:75],
        "serverFamily": str(headers.get("server") or "")[:50],
        "cdnCacheFamily": str(headers.get("x-cache") or "")[:60],
        "hasAkamaiMarker": any(
            str(key).lower().startswith(("x-akamai", "akamai-"))
            for key in headers.keys()
        ),
        "hasCloudflareMarker": "cf-ray" in {str(k).lower() for k in headers},
        "hasCookieHeader": bool(headers.get("set-cookie")),
    }


def network_error(error):
    # Programmer errors must never be misreported as access denial or TLS.
    if isinstance(error, (TypeError, AttributeError, NameError)):
        return "CLIENT_IMPLEMENTATION_ERROR"
    if isinstance(error, json.JSONDecodeError):
        return "INVALID_JSON"
    if "timeout" in type(error).__name__.lower():
        return "TIMEOUT"
    source = str(error).lower()
    if "timeout" in source or "timed out" in source:
        return "TIMEOUT"
    if "http/2" in source or "http2" in source:
        return "HTTP2_PROTOCOL_ERROR"
    if "ssl" in source or "tls" in source:
        return "TLS_ERROR"
    if "name resolution" in source or "dns" in source:
        return "DNS_FAILURE"
    return "NETWORK_ERROR"


def read_json_bounded(response):
    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise ValueError("BODY_TOO_LARGE")
    chunks = []
    total = 0
    for chunk in response.iter_content():
        total += len(chunk)
        if total > MAX_BODY_BYTES:
            raise ValueError("BODY_TOO_LARGE")
        chunks.append(chunk)
    body = b"".join(chunks)
    return json.loads(body.decode("utf-8")), hashlib.sha256(body).hexdigest()


def classify_market(data):
    """Claims from merchant JSON are only hints, never proof of Saudi pricing."""
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    hints = [
        str(data.get("country") or ""),
        str(data.get("market") or ""),
        str(meta.get("title") or ""),
        str(meta.get("desc") or ""),
        str(meta.get("h1") or ""),
    ]
    combined = " ".join(hints).lower()
    if re.search(r"saudi|riyadh|jeddah|السعودية|الرياض|جدة", combined):
        return "SAUDI_HINT_PRESENT_NOT_PROVEN"
    if re.search(r"uae|dubai|abu dhabi|emirates|الإمارات", combined):
        return "UAE_HINT_POSSIBLE_WRONG_MARKET"
    return "MARKET_NOT_ATTESTED"


start = time.monotonic()
try:
    with requests.Session(impersonate="chrome") as session:
        warm = {"step": "warmup", "path": "/uae-en/"}
        try:
            # Redirects are disabled; do not borrow cookies from a different host.
            report["requestCount"] += 1
            with session.stream("GET", WARMUP, timeout=12, allow_redirects=False) as response:
                warm["status"] = response.status_code
                warm["httpVersion"] = str(response.http_version)[:35]
                warm.update(safe_headers(response))
                warm["state"] = "HTTP_OK" if response.status_code == 200 else "HTTP_" + str(response.status_code)
        except Exception as exc:
            warm["state"] = network_error(exc)
            warm["exceptionType"] = type(exc).__name__[:60]
        report["observations"].append(warm)

        search = {
            "step": "search",
            "path": "/_vs/nc/mp-customer-catalog-api/api/v3/search",
        }
        try:
            headers = {
                "accept": "application/json, text/plain, */*",
                "x-locale": "en-sa",
                "x-mp-country": "sa",
                "referer": ORIGIN + "/saudi-en/",
            }
            report["requestCount"] += 1
            with session.stream("GET", SEARCH, headers=headers, timeout=12,
                                allow_redirects=False) as response:
                search["status"] = response.status_code
                search["httpVersion"] = str(response.http_version)[:35]
                search.update(safe_headers(response))
                if response.status_code != 200:
                    search["state"] = "HTTP_" + str(response.status_code)
                elif "json" not in str(response.headers.get("content-type") or "").lower():
                    search["state"] = "NON_JSON_RESPONSE"
                else:
                    payload, body_sha = read_json_bounded(response)
                    if not isinstance(payload, dict):
                        search["state"] = "INVALID_JSON_SHAPE"
                    else:
                        hits = payload.get("hits")
                        search["hitCount"] = len(hits) if isinstance(hits, list) else None
                        search["bodySha256"] = body_sha
                        search["marketEvidence"] = classify_market(payload)
                        search["hasTopLevelCurrency"] = "currency" in payload
                        search["state"] = (
                            "JSON_PRODUCTS_OBSERVED_MARKET_UNVERIFIED"
                            if isinstance(hits, list) and len(hits) > 0
                            else "NO_SEARCH_HITS_OR_UNEXPECTED_SCHEMA"
                        )
        except ValueError as exc:
            search["state"] = str(exc)[:60]
        except Exception as exc:
            search["state"] = network_error(exc)
            search["exceptionType"] = type(exc).__name__[:60]
        report["observations"].append(search)
        report["conclusion"] = search["state"]
        if search["state"] == "HTTP2_PROTOCOL_ERROR":
            # Causal differential only. Do not retry HTTP 403/429, do not try
            # different identities or IPs, and never publish these observations.
            http1 = {
                "step": "search_explicit_http11",
                "path": "/_vs/nc/mp-customer-catalog-api/api/v3/search",
                "purpose": "transport_protocol_comparison_only",
            }
            try:
                report["requestCount"] += 1
                with session.stream(
                    "GET", SEARCH, headers=headers, timeout=12,
                    allow_redirects=False, http_version="v1",
                ) as response:
                    http1["status"] = response.status_code
                    http1["httpVersion"] = str(response.http_version)[:35]
                    http1.update(safe_headers(response))
                    if response.status_code != 200:
                        http1["state"] = "HTTP_" + str(response.status_code)
                    elif "json" not in str(
                        response.headers.get("content-type") or ""
                    ).lower():
                        http1["state"] = "NON_JSON_RESPONSE"
                    else:
                        payload, body_sha = read_json_bounded(response)
                        if not isinstance(payload, dict):
                            http1["state"] = "INVALID_JSON_SHAPE"
                        else:
                            hits = payload.get("hits")
                            http1["hitCount"] = (
                                len(hits) if isinstance(hits, list) else None
                            )
                            http1["bodySha256"] = body_sha
                            http1["marketEvidence"] = classify_market(payload)
                            http1["state"] = (
                                "JSON_PRODUCTS_OBSERVED_MARKET_UNVERIFIED"
                                if isinstance(hits, list) and hits
                                else "NO_SEARCH_HITS_OR_UNEXPECTED_SCHEMA"
                            )
            except ValueError as exc:
                http1["state"] = str(exc)[:60]
                http1["exceptionType"] = type(exc).__name__[:60]
            except Exception as exc:
                http1["state"] = network_error(exc)
                http1["exceptionType"] = type(exc).__name__[:60]
            report["observations"].append(http1)
            if http1["state"] == "JSON_PRODUCTS_OBSERVED_MARKET_UNVERIFIED":
                report["conclusion"] = http1["state"]
        report["sessionCookieCount"] = min(100, len(session.cookies))
except Exception:
    report["conclusion"] = "SESSION_INITIALIZATION_ERROR"
finally:
    report["elapsedMs"] = round((time.monotonic() - start) * 1000)
    with open(OUTPUT, "w", encoding="utf8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    # A valid JSON payload with matching source data is connectivity evidence only.
    if report["conclusion"] != "JSON_PRODUCTS_OBSERVED_MARKET_UNVERIFIED":
        raise SystemExit(1)
