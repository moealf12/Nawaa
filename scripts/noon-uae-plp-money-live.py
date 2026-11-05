#!/usr/bin/env python3
"""Live diagnostic: Noon UAE PLP price representation and currency evidence.

Four real same-origin public GET requests max. Headers and session remain
coherent; no proxy, retries, access-block workaround, or customer publishing.
No raw HTML archived. Small SKU-scoped samples of rendered monetary semantics.
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

BASE = "https://www.noon.com"
QUERIES = ("PlayStation 5", "iPhone 17", "سماعات بلوتوث")
OUT = "noon-uae-plp-money-live.json"
MAX_RESPONSE = 5_000_000
SKU_RE = re.compile(r"/(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
MONEY = re.compile(r"(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?")
AED = re.compile(r"(?<![A-Za-z])AED(?![A-Za-z])|د[.]?\s*إ", re.I)
REPORT = {
    "schema": "nawaa.noon-ae.plp-money-evidence.v1",
    "sha": os.getenv("PULL_REQUEST_HEAD_SHA", ""),
    "atUtc": datetime.now(timezone.utc).isoformat(),
    "queries": list(QUERIES),
    "requestBudget": 4,
    "requestCount": 0,
    "retries": 0,
    "proxy": False,
    "customerPublishable": False,
    "observations": [],
    "sourceAccepted": False,
}


def same_origin(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme == "https" and parsed.hostname == "www.noon.com"
                and parsed.username is None and parsed.password is None
                and parsed.port in (None, 443))
    except ValueError:
        return False


def fetch(session, url, step):
    row = {"step": step}
    began = time.monotonic()
    REPORT["requestCount"] += 1
    if REPORT["requestCount"] > 4 or not same_origin(url):
        raise ValueError("REQUEST_BUDGET_ORIGIN_BLOCK")
    try:
        response = session.get(
            url, timeout=12, allow_redirects=False,
            headers={"accept": "text/html,application/xhtml+xml"},
        )
        row["http"] = response.status_code
        row["bytes"] = len(response.content)
        row["contentType"] = str(response.headers.get("content-type") or "")[:50]
        if (response.status_code == 200 and same_origin(str(response.url))
                and "html" in row["contentType"].lower()
                and len(response.content) <= MAX_RESPONSE):
            row["sha256"] = hashlib.sha256(response.content).hexdigest()
            return row, response.content
        row["failure"] = (
            "SOURCE_ACCESS_DENIED" if response.status_code == 403
            else "SOURCE_RATE_LIMITED" if response.status_code == 429
            else "UNEXPECTED_SOURCE_HTTP_OR_CONTENT"
        )
        return row, None
    except Exception as exc:
        row["failure"] = type(exc).__name__[:50]
        return row, None
    finally:
        row["elapsedMs"] = round(1000 * (time.monotonic() - began))
        REPORT["observations"].append(row)


def card_view(anchor):
    link = anchor.get("href")
    if not isinstance(link, str):
        return None
    url = urljoin(BASE + "/uae-en/", link)
    if not same_origin(url):
        return None
    u = urlsplit(url)
    if not u.path.startswith("/uae-en/"):
        return None
    m = SKU_RE.search(u.path)
    if not m:
        return None
    root = anchor.select_one('[data-qa="plp-product-box-price"]')
    amount = root.select_one("strong") if root else None
    if amount is None:
        return None
    displayed = amount.get_text(" ", strip=True).replace("\u00a0", " ").strip()
    if not MONEY.fullmatch(displayed):
        return None
    precision = (
        len(displayed.split(".", 1)[1]) if "." in displayed else 0
    )
    parent_text = root.get_text(" ", strip=True)[:160]
    monetary_attrs = {}
    for node in (anchor, root, amount):
        for k, v in node.attrs.items():
            if re.search("curr|price|aria|title", k, re.I):
                monetary_attrs[str(k)[:50]] = str(v)[:60]
    text_codepoints = [
        "U+" + format(ord(char), "04X") for char in parent_text[:30]
        if ord(char) >= 0xE000 or char in ("د", "إ", "ﺩ")
    ]
    return {
        "sku": m.group(1).upper(),
        "displayedPrice": displayed,
        "decimalDigitsRendered": precision,
        "priceRootText": parent_text,
        "explicitAedLabelInPriceRoot": bool(AED.search(parent_text)),
        "pricePrivateUseGlyphs": text_codepoints,
        "priceAttributes": monetary_attrs,
        "scriptOfferCode": bool(
            re.fullmatch(r"[A-Za-z0-9-]{1,100}",
                         (dict(x.split("=", 1) for x in u.query.split("&")
                               if "=" in x)).get("o", ""))
        ),
    }


def extract(body, query):
    soup = BeautifulSoup(body, "html.parser")
    lang = soup.html.get("lang") if soup.html else ""
    h1 = soup.select_one("h1")
    title = h1.get_text(" ", strip=True) if h1 else ""
    valid = (
        str(lang).casefold() in ("en-ae", "ar-ae")
        and " ".join(title.casefold().split()) == " ".join(query.casefold().split())
    )
    products = []
    seen = set()
    distribution = {}
    for anchor in soup.select('a[href*="/p/"]')[:350]:
        card = card_view(anchor)
        if card is None or card["sku"] in seen:
            continue
        seen.add(card["sku"])
        distribution[card["decimalDigitsRendered"]] = (
            distribution.get(card["decimalDigitsRendered"], 0) + 1
        )
        if len(products) < 7:
            products.append(card)
    meta = []
    for node in soup.select(
        'meta[itemprop="priceCurrency"], meta[name="currency"],'
        'meta[property="product:price:currency"]'
    )[:12]:
        val = node.get("content")
        if isinstance(val, str):
            meta.append(val[:20])
    return {
        "lang": lang,
        "h1MatchesQuery": valid,
        "distinctSkuCards": len(seen),
        "priceDecimalDigitsDistribution": distribution,
        "sourceMetaCurrency": meta,
        "sampleCards": products,
        "sourceScriptContainsTsr": any(
            "self.$R" in (x.string or "") for x in soup.find_all("script", limit=160)
        ),
    }


try:
    with requests.Session(impersonate="chrome") as session:
        _, warm = fetch(session, BASE + "/uae-en/", "uae_warmup")
        if warm is not None:
            for query in QUERIES:
                _, body = fetch(
                    session, BASE + "/uae-en/search/?" + urlencode({"q": query}),
                    "uae_search_" + str(len(REPORT["observations"]))
                )
                if body is None:
                    break
                REPORT["observations"][-1]["catalog"] = extract(body, query)
    searches = [x for x in REPORT["observations"] if x["step"].startswith("uae_search_")]
    REPORT["sourceAccepted"] = (
        len(searches) == len(QUERIES)
        and all(x.get("catalog", {}).get("h1MatchesQuery")
                and x.get("catalog", {}).get("distinctSkuCards", 0) >= 5
                for x in searches)
    )
finally:
    with open(OUT, "w", encoding="utf8") as f:
        json.dump(REPORT, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(json.dumps(REPORT, ensure_ascii=False, indent=2))
    if not REPORT["sourceAccepted"]:
        raise SystemExit(1)
