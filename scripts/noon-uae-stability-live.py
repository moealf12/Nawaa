#!/usr/bin/env python3
"""Noon UAE bounded LIVE availability experiment with independent cookie jars.

This is a source reliability diagnostic, not a customer-offer collector.
MAX 3 sessions and 6 public HTTP GET requests. Never changes headers after
errors, retries a blocked source, uses a proxy, or publishes prices.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests

from noon_uae_request_policy import classify_source_response

BASE = "https://www.noon.com"
SEARCH = BASE + "/uae-en/search/?"
QUERIES = ("PlayStation 5", "iPhone 17", "سماعات بلوتوث")
REPORT_FILE = "noon-uae-stability-live.json"
MAX_SESSIONS = 3
MAX_REQUESTS = 2 * MAX_SESSIONS
MAX_BODY_BYTES = 5_000_000
TIMEOUT_SECONDS = 12
SOURCE_SKU = re.compile(r"/(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
RESULT = {
    "schema": "nawaa.noon-ae.stability-snapshot.v1",
    "headSha": os.environ.get("PULL_REQUEST_HEAD_SHA", ""),
    "observedUtc": datetime.now(timezone.utc).isoformat(),
    "source": "NOON_AE_PUBLIC_HTML",
    "sessionCountPlanned": MAX_SESSIONS,
    "maxRequests": MAX_REQUESTS,
    "requestsAttempted": 0,
    "retries": 0,
    "headerRotation": False,
    "useProxies": False,
    "customerPublishable": False,
    "saudiDeliveryVerified": False,
    "sessions": [],
    "classification": "NOT_STARTED",
}


def classify_exception(exc):
    d = classify_source_response(error=exc)
    return {"state": d["code"], "action": d["action"], "retry": False}


def same_origin(raw):
    try:
        url = urlsplit(raw)
        return (url.scheme == "https" and url.hostname == "www.noon.com"
                and url.username is None and url.password is None
                and url.port in (None, 443))
    except ValueError:
        return False


def fetch(session, url, label):
    if RESULT["requestsAttempted"] >= MAX_REQUESTS or not same_origin(url):
        raise RuntimeError("SOURCE_REQUEST_LIMIT_OR_ORIGIN_VIOLATION")
    RESULT["requestsAttempted"] += 1
    evidence = {"step": label}
    started = time.monotonic()
    body = None
    try:
        response = session.get(
            url, timeout=TIMEOUT_SECONDS, allow_redirects=False,
            headers={"accept": "text/html,application/xhtml+xml"},
        )
        status = response.status_code
        decision = classify_source_response(
            status=status, retry_after=response.headers.get("retry-after")
        )
        evidence.update({
            "status": status,
            "decision": decision["code"],
            "action": decision["action"],
            "cooldownSeconds": decision["delaySeconds"],
            "mime": str(response.headers.get("content-type") or "")[:75],
            "bytes": len(response.content),
        })
        if (status == 200 and same_origin(str(response.url))
                and evidence["mime"].lower().startswith("text/html")
                and len(response.content) <= MAX_BODY_BYTES):
            body = response.content
            evidence["sha256"] = hashlib.sha256(body).hexdigest()
            evidence["state"] = "HTML_RECEIVED"
        else:
            evidence["state"] = decision["code"]
    except Exception as exc:
        evidence.update(classify_exception(exc))
        evidence["exceptionType"] = type(exc).__name__[:40]
    finally:
        evidence["elapsedMs"] = round(1000 * (time.monotonic() - started))
    return evidence, body


def search_evidence(body, query):
    soup = BeautifulSoup(body, "html.parser")
    lang = str(soup.html.get("lang") or "") if soup.html else ""
    h1 = soup.select_one("h1")
    heading = h1.get_text(" ", strip=True) if h1 else ""
    h1_matches = " ".join(heading.casefold().split()) == " ".join(
        query.casefold().split()
    )
    valid_market = lang.casefold() in ("en-ae", "ar-ae")
    product_skus = set()
    valid_link_count = 0
    for anchor in soup.select('a[href*="/p/"]')[:400]:
        href = anchor.get("href")
        if not isinstance(href, str) or len(href) > 2500:
            continue
        product_url = urljoin(BASE + "/uae-en/", href)
        if not same_origin(product_url):
            continue
        u = urlsplit(product_url)
        if not u.path.startswith("/uae-en/"):
            continue
        match = SOURCE_SKU.search(u.path)
        if not match:
            continue
        valid_link_count += 1
        product_skus.add(match.group(1).upper())
    accepted = h1_matches and valid_market and len(product_skus) >= 5
    return {
        "queryH1Matches": h1_matches,
        "marketLocaleVerified": valid_market,
        "skuLinksObserved": valid_link_count,
        "distinctSkuCount": len(product_skus),
        "catalogHtmlAcquired": accepted,
        "priceOrShippingAttested": False,
    }


halted = False
started = time.monotonic()
try:
    for index, query in enumerate(QUERIES):
        if halted:
            break
        if index:
            # Fixed pacing, not stealth, not an immediate retry of failed route.
            time.sleep(2)
        one = {"session": index + 1, "query": query}
        with requests.Session(impersonate="chrome") as session:
            warm, warm_body = fetch(session, BASE + "/uae-en/", "warmup")
            one["warmup"] = warm
            if warm_body is None:
                one["state"] = "WARMUP_NOT_AVAILABLE"
                halted = True
            else:
                search_url = SEARCH + urlencode({"q": query})
                found, search_body = fetch(session, search_url, "search")
                one["search"] = found
                if search_body is None:
                    one["state"] = "SEARCH_NOT_AVAILABLE"
                    # Never cycle another cookie jar to probe around a denial.
                    halted = True
                else:
                    one["catalog"] = search_evidence(search_body, query)
                    one["state"] = (
                        "LIVE_SOURCE_CATALOG_OBSERVED"
                        if one["catalog"]["catalogHtmlAcquired"]
                        else "HTML_200_WITHOUT_VERIFIED_CATALOG"
                    )
        RESULT["sessions"].append(one)
        if one["state"] != "LIVE_SOURCE_CATALOG_OBSERVED":
            halted = True
    RESULT["successfulIndependentSessions"] = sum(
        row.get("state") == "LIVE_SOURCE_CATALOG_OBSERVED"
        for row in RESULT["sessions"]
    )
    RESULT["completedIndependentSessions"] = len(RESULT["sessions"])
    RESULT["observedSnapshotRate"] = (
        RESULT["successfulIndependentSessions"] / len(RESULT["sessions"])
        if RESULT["sessions"] else None
    )
    RESULT["classification"] = (
        "THREE_LIVE_SESSIONS_WITH_VALID_SEARCH_HTML"
        if RESULT["successfulIndependentSessions"] == MAX_SESSIONS
        else "SOURCE_UNSTABLE_OR_INCOMPLETE"
    )
except Exception as exc:
    RESULT["classification"] = "PROBE_FAILED_CLOSED"
    RESULT["fatalType"] = type(exc).__name__[:60]
finally:
    RESULT["durationMs"] = round(1000 * (time.monotonic() - started))
    RESULT["releaseAccepted"] = False
    with open(REPORT_FILE, "w", encoding="utf8") as f:
        json.dump(RESULT, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(RESULT, ensure_ascii=False, indent=2))
    if RESULT["classification"] != "THREE_LIVE_SESSIONS_WITH_VALID_SEARCH_HTML":
        raise SystemExit(1)
