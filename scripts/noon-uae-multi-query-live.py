#!/usr/bin/env python3
"""Proof-of-source for real Noon UAE search cards from public HTML.

Noon Saudi is separate; this collector never relabels UAE prices as Saudi.
No auth, no paid proxies, no CAPTCHA, no retries, no customer publishing.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit, parse_qs, urlencode

from bs4 import BeautifulSoup
from curl_cffi import requests

BASE = "https://www.noon.com"
QUERY = os.getenv("NOON_SEARCH_QUERY", "").strip()
QUERY_ID = os.getenv("NOON_QUERY_ID", "").strip()
if not (2 <= len(QUERY) <= 120) or any(ord(c) < 32 for c in QUERY):
    raise SystemExit("INVALID_SEARCH_QUERY")
if not re.fullmatch(r"[a-z0-9-]{2,32}", QUERY_ID):
    raise SystemExit("INVALID_QUERY_ID")
SEARCH = BASE + "/uae-en/search/?" + urlencode({"q": QUERY})
SKU_RE = re.compile(r"/(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
MAX_BYTES = 5_000_000
MAX_ANCHORS = 250
REPORT_FILE = f"noon-uae-search-{QUERY_ID}.json"
report = {
    "schema": "nawaa.noon-ae.multi-query-live-proof.v1",
    "observedAtUTC": datetime.now(timezone.utc).isoformat(),
    "headSha": os.getenv("PULL_REQUEST_HEAD_SHA", ""),
    "query": QUERY,
    "queryId": QUERY_ID,
    "market": "AE",
    "expectedCurrency": "AED",
    "requestsAttempted": 0,
    "retries": 0,
    "proxyUsed": False,
    "customerPublishable": False,
    "pdpPriceVerified": False,
    "source": "noon-uae-html",
    "stages": [],
    "conclusion": "NOT_STARTED",
}


def error_kind(exc):
    name = type(exc).__name__
    msg = str(exc).lower()
    if name in ("TypeError", "NameError", "AttributeError"):
        return "CODE_ERROR"
    if "timeout" in name.lower() or "timeout" in msg:
        return "TIMEOUT"
    if "http/2" in msg or "http2" in msg or "errcode: 92" in msg:
        return "HTTP2_ERROR"
    return "NETWORK_OR_SOURCE_ERROR"


def safe_url(href):
    if not isinstance(href, str) or len(href) > 3000:
        return None
    try:
        u = urlsplit(urljoin(BASE + "/uae-en/", href))
        if (u.scheme != "https" or u.hostname not in ("noon.com", "www.noon.com")
                or u.username or u.password or u.port not in (None, 443)
                or not u.path.startswith("/uae-en/")):
            return None
        sku_match = SKU_RE.search(u.path)
        if not sku_match:
            return None
        offer_codes = parse_qs(u.query).get("o", [])
        offer_code = (offer_codes[0] if len(offer_codes) == 1 and
                      re.fullmatch("[a-zA-Z0-9-]{1,100}", offer_codes[0])
                      else None)
        return {"sku": sku_match.group(1).upper(), "url": u.scheme + "://" +
                u.netloc + u.path, "offerCode": offer_code}
    except ValueError:
        return None


def price_value(raw):
    if not isinstance(raw, str):
        return None
    s = (raw.strip().replace("\ue000", "")
         .replace("\u00a0", " ").replace("\u202f", " ")
         .replace("\u066c", ",").replace("\u066b", "."))
    s = "".join(str(ord(c) - 0x660) if "\u0660" <= c <= "\u0669" else
                str(ord(c) - 0x6f0) if "\u06f0" <= c <= "\u06f9" else c
                for c in s).strip()
    has_aed = bool(re.search(r"\bAED\b|د\.?\s?إ", s, flags=re.I))
    s = re.sub(r"\bAED\b|د\.?\s?إ", "", s, flags=re.I).strip()
    plain = r"(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?"
    comma = r"[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?"
    if re.fullmatch(plain, s):
        n = float(s)
    elif re.fullmatch(comma, s):
        n = float(s.replace(",", ""))
    else:
        return None
    return (round(n, 2), has_aed) if 0 < n < 10_000_000 else None


def source_image(raw):
    """Accept product CDN images, NOT Noon UI placeholder/logo assets."""
    if not isinstance(raw, str) or len(raw) > 3000:
        return None
    try:
        u = urlsplit(raw)
        if (u.scheme == "https" and u.hostname in
                ("f.nooncdn.com", "f.nooncdn.com") and
                u.path.startswith("/p/") and not u.username and not u.password):
            return raw[:2000]
    except ValueError:
        pass
    return None


def media_candidates(value):
    if not isinstance(value, str):
        return
    # srcset stores alternatives as "url 800w, url 1200w".
    for entry in value.split(",")[:20]:
        token = entry.strip().split(" ")[0]
        if token:
            yield token


def find_image(anchor):
    for node in anchor.select("picture source, img"):
        for attr in ("srcset", "data-srcset", "data-src", "data-original",
                     "data-lazy-src", "src"):
            for candidate in media_candidates(node.get(attr)):
                valid = source_image(candidate)
                if valid:
                    return valid
    return None


def media_inspection(anchor):
    """Bounded attr diagnostics: never dump raw HTML or arbitrary DOM text."""
    output = []
    for node in anchor.select("picture source, img")[:3]:
        entry = {"tag": node.name}
        for attr in ("srcset", "data-srcset", "data-src", "data-original",
                     "data-lazy-src", "src"):
            val = node.get(attr)
            if isinstance(val, str):
                entry[attr] = val[:240]
        output.append(entry)
    return output


def extract(html):
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.select_one("h1")
    heading_txt = heading.get_text(" ", strip=True) if heading else ""
    def normalize_intent(text):
        return " ".join(text.casefold().split())

    context_matched = normalize_intent(heading_txt) == normalize_intent(QUERY)
    anchors = soup.select('a[href*="/p/"]')[:MAX_ANCHORS]
    output = {
        "heading": heading_txt[:120],
        "headingMatchesQuery": context_matched,
        "documentLanguage": str(soup.html.get("lang") if soup.html else "")[:50],
        "anchorsWithProductPath": len(anchors),
        "validSkuLinks": 0,
        "titleSelectorsFound": 0,
        "priceSelectorsFound": 0,
        "imageUrlsFound": 0,
        "pricedCards": 0,
        "completeCards": 0,
        "observedCurrencyLabelCount": 0,
        "candidateSample": [],
        "structureSample": [],
        "imageAttributeSample": [],
    }
    candidates = []
    for a in anchors:
        info = safe_url(a.get("href"))
        if not info:
            continue
        output["validSkuLinks"] += 1
        title_node = a.select_one('[data-qa="plp-product-box-name"]')
        if title_node is None:
            title_node = a.select_one("h2, h3")
        title = title_node.get_text(" ", strip=True) if title_node else ""
        if title and len(title) <= 350:
            output["titleSelectorsFound"] += 1
        price_node = a.select_one('[data-qa="plp-product-box-price"] strong[class*="amount"]')
        if price_node is None:
            price_node = a.select_one('[data-qa="plp-product-box-price"] strong')
        if price_node:
            output["priceSelectorsFound"] += 1
        raw_price = price_node.get_text(" ", strip=True) if price_node else ""
        amount = price_value(raw_price)
        img = find_image(a)
        if len(output["imageAttributeSample"]) < 2:
            output["imageAttributeSample"].append(media_inspection(a))
        if img:
            output["imageUrlsFound"] += 1
        if amount:
            output["pricedCards"] += 1
            if amount[1]:
                output["observedCurrencyLabelCount"] += 1
        if len(output["structureSample"]) < 3:
            output["structureSample"].append({
                "sku": info["sku"],
                "hasTitle": bool(title),
                "hasPriceElement": bool(price_node),
                "sourcePriceText": raw_price[:50] if raw_price else None,
                "hasNoonImage": bool(img),
                "urlPath": urlsplit(info["url"]).path[:180],
            })
        if not title or not amount or not img:
            continue
        candidate = {
            "sku": info["sku"],
            "title": title[:200],
            "offerCode": info["offerCode"],
            "productUrl": info["url"],
            "sourceImageUrl": img,
            "observedPrice": amount[0],
            "currencyHeaderRequested": "AED",
            "currencyLabelInPrice": amount[1],
            "pdpPriceVerified": False,
            "customerPublishable": False,
        }
        candidates.append(candidate)
    output["completeCards"] = len(candidates)
    output["candidateSample"] = candidates[:3] if context_matched else []
    if not context_matched:
        output["state"] = "SEARCH_CONTEXT_NOT_ATTESTED"
        return output, []
    if output["documentLanguage"].strip().casefold() not in ("en-ae", "ar-ae"):
        output["state"] = "UAE_MARKET_LOCALE_NOT_ATTESTED"
        output["candidateSample"] = []
        return output, []
    return output, candidates


def get(session, url, label):
    stage = {"step": label}
    report["requestsAttempted"] += 1
    now = time.monotonic()
    body = None
    try:
        r = session.get(url, timeout=12, allow_redirects=False,
                        headers={"accept": "text/html,application/xhtml+xml"})
        stage["status"] = r.status_code
        stage["contentType"] = str(r.headers.get("content-type") or "")[:75]
        stage["httpVersion"] = str(r.http_version)[:20]
        stage["responseBytes"] = len(r.content)
        stage["originPinned"] = urlsplit(str(r.url)).hostname == "www.noon.com"
        if (r.status_code == 200 and stage["originPinned"] and
                "html" in stage["contentType"].lower() and
                len(r.content) <= MAX_BYTES):
            body = r.content
            stage["sha256"] = hashlib.sha256(body).hexdigest()
            stage["state"] = "HTML_200_RECEIVED"
        else:
            stage["state"] = "HTTP_" + str(r.status_code)
    except Exception as exc:
        stage["state"] = error_kind(exc)
        stage["exceptionType"] = type(exc).__name__[:55]
    stage["elapsedMs"] = round((time.monotonic() - now) * 1000)
    report["stages"].append(stage)
    return stage, body


start = time.monotonic()
try:
    with requests.Session(impersonate="chrome") as session:
        _, warm = get(session, BASE + "/uae-en/", "warmup_uae")
        if warm is None:
            report["conclusion"] = "UAE_WARMUP_UNAVAILABLE"
        else:
            stage, search_html = get(session, SEARCH, "uae_search_html")
            if search_html is None:
                report["conclusion"] = "UAE_SEARCH_UNAVAILABLE"
            else:
                facts, cards = extract(search_html)
                stage["extraction"] = facts
                if cards:
                    report["conclusion"] = "LIVE_UAE_HTML_PRICE_IMAGE_CANDIDATES"
                    # PDP is a separate source verification gate. It was 403
                    # in the source control, so avoid retry amplification.
                    report["pdpProbe"] = "SKIPPED_IN_MULTI_QUERY_DISCOVERY"
                else:
                    report["conclusion"] = "UAE_PRODUCT_ANCHORS_WITHOUT_FULL_CARD_EVIDENCE"
except Exception as exc:
    report["conclusion"] = error_kind(exc)
finally:
    report["elapsedMs"] = round((time.monotonic() - start) * 1000)
    with open(REPORT_FILE, "w", encoding="utf8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["conclusion"] != "LIVE_UAE_HTML_PRICE_IMAGE_CANDIDATES":
        raise SystemExit(1)
