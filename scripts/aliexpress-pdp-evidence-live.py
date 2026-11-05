#!/usr/bin/env python3
"""Live AliExpress PDP evidence probe for user-supplied item IDs.

No session/link tracking parameters are fetched, stored, or logged. Search
query parameter offers, URL marketing discounts, and guessed buyboxes are NOT
proof of current product price. All findings remain experimental.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
from curl_cffi import requests

_spec = importlib.util.spec_from_file_location(
    "aliexpress_public_probe", Path(__file__).resolve().with_name("aliexpress-public-html-live.py")
)
_shared = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _shared
_spec.loader.exec_module(_shared)

MAX_PDP_BYTES = 3_500_000
PDP_HOST = "ar.aliexpress.com"
BASE = "https://" + PDP_HOST
CHALLENGE = _shared.CHALLENGE


def safely_matched_product_jsonld(html, item_id):
    """Corroborate only Product JSON-LD scoped to the exact requested item."""
    document = BeautifulSoup(html, "html.parser")
    records = []
    checked = 0

    def descend(value, depth=0):
        if depth > 5:
            return
        if isinstance(value, list):
            for x in value[:40]:
                descend(x, depth + 1)
            return
        if not isinstance(value, dict):
            return
        kind = value.get("@type")
        is_product = "Product" in kind if isinstance(kind, list) else (
            isinstance(kind, str) and kind.casefold() == "product"
        )
        if is_product:
            records.append(value)
        for key in ("@graph", "itemListElement", "item"):
            if key in value:
                descend(value[key], depth + 1)

    for element in document.select('script[type="application/ld+json"]')[:20]:
        checked += 1
        if len(element.get_text()) > 250_000:
            continue
        try:
            descend(json.loads(element.get_text()))
        except (TypeError, ValueError):
            continue
    valid = []
    for entry in records:
        url = _shared.product_link(entry.get("url"), item_id)
        if not url:
            continue
        if entry.get("sku") is not None and str(entry.get("sku")) != item_id:
            continue
        offers = entry.get("offers")
        offers = offers if isinstance(offers, list) else [offers]
        if len(offers) != 1 or not isinstance(offers[0], dict):
            continue
        offer = offers[0]
        if offer.get("@type") not in (None, "Offer"):
            continue
        if any(offer.get(x) is not None for x in ("lowPrice", "highPrice", "priceSpecification")):
            continue
        offer_url = offer.get("url")
        if offer_url and not _shared.product_link(offer_url, item_id):
            continue
        price = _shared.exact_price(offer.get("price"))
        currency = offer.get("priceCurrency")
        if not price or not isinstance(currency, str) or not re.fullmatch("[A-Z]{3}", currency):
            continue
        valid.append({
            "priceOriginal": price,
            "currency": currency,
            "evidenceTier": "PRODUCT_JSONLD_SAME_ID_SINGLE_OFFER",
            "offerUrlMatched": bool(offer_url),
        })
    if len(valid) != 1:
        return {"state": "NO_UNAMBIGUOUS_EXACT_ID_PRODUCT_JSONLD",
                "scriptCount": checked, "productNodes": len(records),
                "matchedPricedNodes": len(valid)}
    return {"state": "SAME_ITEM_JSONLD_PRICE_CANDIDATE",
            "scriptCount": checked, "productNodes": len(records),
            "matchedPricedNodes": 1, "priceEvidence": valid[0]}


def probe_item(item_id):
    if not _shared.ID.fullmatch(item_id):
        raise ValueError("INVALID_ITEM_ID")
    url = BASE + "/item/" + item_id + ".html"
    report = {
        "schema": "nawaa.aliexpress.pdp-live-evidence.v1",
        "itemId": item_id, "canonicalUrl": url,
        "observedUtc": datetime.now(timezone.utc).isoformat(),
        "retries": 0, "proxyUsed": False, "captchaSolved": False,
        "customerPublishable": False, "stages": [],
        "conclusion": "NOT_STARTED",
    }
    with requests.Session(impersonate="chrome") as sess:
        headers = {
            "user-agent": _shared.USER_AGENT,
            "accept": "text/html,application/xhtml+xml",
            "accept-language": "ar-SA,ar;q=0.9,en;q=0.5",
        }
        robots_started = time.monotonic()
        try:
            robots = sess.get(BASE + "/robots.txt", headers={**headers, "accept": "text/plain"}, timeout=12, allow_redirects=False)
            robots_ok = robots.status_code == 200 and 0 < len(robots.content) <= 150000
            policy = RobotFileParser()
            if robots_ok:
                policy.parse(robots.text.splitlines())
                robots_ok = policy.can_fetch(_shared.USER_AGENT.split("/", 1)[0], url)
            report["stages"].append({"step": "robots_policy", "status": robots.status_code,
                                      "state": "ALLOWED" if robots_ok else "NOT_ALLOWED_OR_UNAVAILABLE",
                                      "elapsedMs": round((time.monotonic() - robots_started) * 1000)})
        except Exception as exc:
            robots_ok = False
            report["stages"].append({"step": "robots_policy", "state": "TRANSPORT_FAILURE",
                                      "exceptionType": type(exc).__name__})
        if not robots_ok:
            report["conclusion"] = "ROBOTS_POLICY_NOT_VERIFIED"
            return report

        started = time.monotonic()
        try:
            response = sess.get(url, headers=headers, timeout=15, allow_redirects=False)
            data = response.content
            response_url = urlsplit(str(response.url))
            content_type = response.headers.get("content-type", "").lower()
            valid = (response.status_code == 200 and response_url.hostname == PDP_HOST
                     and "html" in content_type and 0 < len(data) <= MAX_PDP_BYTES)
            stage = {"step": "pdp_html", "status": response.status_code,
                     "bytes": len(data), "contentType": content_type[:70],
                     "originPinned": response_url.hostname == PDP_HOST,
                     "elapsedMs": round((time.monotonic() - started) * 1000)}
            if not valid:
                stage["state"] = "PDP_HTTP_OR_CONTENT_REJECTED"
                report["conclusion"] = "PDP_SOURCE_UNAVAILABLE"
            else:
                html = data.decode("utf-8", "replace")
                if CHALLENGE.search(html):
                    stage["state"] = "PDP_CHALLENGE_NOT_CATALOG"
                    report["conclusion"] = "PDP_CHALLENGE_NOT_CATALOG"
                else:
                    stage["state"] = "PDP_HTML_RECEIVED"
                    soup = BeautifulSoup(html, "html.parser")
                    meta = soup.select_one('meta[property="og:title"]')
                    image_meta = soup.select_one('meta[property="og:image"]')
                    title = (meta.get("content") or "")[:250] if meta else ""
                    image = _shared.product_image(
                        image_meta.get("content") if image_meta else None
                    )
                    report["productIdentity"] = {
                        "pageTitleCandidate": title or None,
                        "sourceImageCandidate": image,
                        "identitySource": "PDP_META_NOT_OFFER_PROOF",
                        "jsonLd": safely_matched_product_jsonld(html, item_id),
                    }
                    report["conclusion"] = (
                        "PDP_PRODUCT_JSONLD_PRICE_CANDIDATE"
                        if report["productIdentity"]["jsonLd"]["state"]
                        == "SAME_ITEM_JSONLD_PRICE_CANDIDATE"
                        else "PDP_RECEIVED_PRICE_NOT_ATTESTED"
                    )
            report["stages"].append(stage)
        except Exception as exc:
            report["stages"].append({
                "step": "pdp_html", "state": "TRANSPORT_FAILURE",
                "exceptionType": type(exc).__name__[:60],
            })
            report["conclusion"] = "PDP_SOURCE_UNAVAILABLE"
    return report


def main():
    raw = os.getenv("ALIEXPRESS_ITEM_ID", "")
    if not _shared.ID.fullmatch(raw):
        raise SystemExit("INVALID_ALIEXPRESS_ITEM_ID")
    report = probe_item(raw)
    with open("aliexpress-pdp-" + raw + ".json", "w", encoding="utf8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["conclusion"] not in (
        "PDP_PRODUCT_JSONLD_PRICE_CANDIDATE", "PDP_RECEIVED_PRICE_NOT_ATTESTED"
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
