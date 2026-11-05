#!/usr/bin/env python3
"""Live independent PLP/PDP evidence across 3 categories and language types.

No proxy or header rotation; each of 3 sessions uses warmup + PLP + one PDP.
Source failures are documented and stop further requests. No HTML archives,
no checkout or order submission, no customer publishing. Source market UAE.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests

from noon_uae_price_precision import (
    interpret_price_surfaces, select_source_current_offer_amount,
)
from noon_uae_price_policy import cents
from noon_uae_tsr_ast import inspect_tsr_ast

BASE = "https://www.noon.com"
QUERIES = ("PlayStation 5", "iPhone 17", "سماعات بلوتوث")
SKU = re.compile(r"/(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
MONEY = re.compile(r"(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?")
REPORT_FILE = "noon-uae-live-price-pair-matrix.json"
REPORT = {
    "schema": "nawaa.noon-ae.multi-category-price-pair.v1",
    "gitSha": os.getenv("PULL_REQUEST_HEAD_SHA", ""),
    "atUtc": datetime.now(timezone.utc).isoformat(),
    "maxSessions": 3,
    "maxRequests": 9,
    "requestsAttempted": 0,
    "retries": 0,
    "proxy": False,
    "headerRotation": False,
    "customerPublishable": False,
    "shippingToSaudiOptional": True,
    "cases": [],
    "sourceAcceptance": "NOT_RUN",
}


def same_origin(uri):
    try:
        u = urlsplit(uri)
        return (u.scheme == "https" and u.hostname == "www.noon.com"
                and u.username is None and u.password is None
                and u.port in (None, 443))
    except ValueError:
        return False


def fetch(session, url, tag):
    begin = time.monotonic()
    state = {"stage": tag}
    body = None
    try:
        if REPORT["requestsAttempted"] >= 9 or not same_origin(url):
            state["failure"] = "REQUEST_BUDGET_ORIGIN_REJECTED"
            return state, None
        REPORT["requestsAttempted"] += 1
        response = session.get(
            url, timeout=12, allow_redirects=False,
            headers={"accept": "text/html,application/xhtml+xml"},
        )
        state["status"] = response.status_code
        state["bytes"] = len(response.content)
        mime = str(response.headers.get("content-type") or "")
        if (response.status_code == 200 and "html" in mime.lower()
                and len(response.content) <= 5_000_000
                and same_origin(str(response.url))):
            body = response.content
            state["sha256"] = hashlib.sha256(body).hexdigest()
            state["state"] = "SOURCE_HTML"
        else:
            state["state"] = (
                "ACCESS_DENIED" if response.status_code == 403
                else "RATE_LIMIT" if response.status_code == 429
                else "UNVERIFIED_SOURCE_RESPONSE"
            )
    except Exception as exc:
        state["state"] = "NETWORK_EXCEPTION"
        state["exceptionType"] = type(exc).__name__[:50]
    finally:
        state["elapsedMs"] = round(1000 * (time.monotonic() - begin))
    return state, body


def choose(html, query):
    soup = BeautifulSoup(html, "html.parser")
    lang = soup.html.get("lang") if soup.html else ""
    heading = soup.select_one("h1")
    h1 = heading.get_text(" ", strip=True) if heading else ""
    if (str(lang).casefold() not in ("en-ae", "ar-ae") or
            " ".join(h1.casefold().split()) != " ".join(query.casefold().split())):
        return None
    for a in soup.select('a[href*="/p/"]')[:180]:
        link = a.get("href")
        if not isinstance(link, str):
            continue
        url = urljoin(BASE, link)
        if not same_origin(url):
            continue
        u = urlsplit(url)
        if not u.path.startswith("/uae-en/"):
            continue
        match = SKU.search(u.path)
        offers = parse_qs(u.query).get("o", [])
        if not match or len(offers) != 1:
            continue
        if not re.fullmatch(r"[A-Za-z0-9-]{1,100}", offers[0]):
            continue
        amount = a.select_one('[data-qa="plp-product-box-price"] strong')
        name = a.select_one('[data-qa="plp-product-box-name"]')
        if amount is None or name is None:
            continue
        price = amount.get_text(" ", strip=True).replace("\u00a0", "").strip()
        if not MONEY.fullmatch(price) or not name.get_text(" ", strip=True):
            continue
        return {
            "sku": match.group(1).upper(),
            "offerCode": offers[0],
            "url": url,
            "plpPrice": price,
        }
    return None


def product_seo(html, item):
    soup = BeautifulSoup(html, "html.parser")
    lang = soup.html.get("lang") if soup.html else ""
    out = {"lang": lang, "matchedProduct": False, "matchedOfferAmounts": []}
    if str(lang).casefold() not in ("en-ae", "ar-ae"):
        return out, soup
    for script in soup.select('script[type="application/ld+json"]')[:40]:
        raw = script.string or script.get_text()
        if not raw or len(raw) > 300_000:
            continue
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            continue
        stack = [obj]
        budget = 0
        while stack and budget < 1000:
            budget += 1
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node[:100])
                continue
            if not isinstance(node, dict):
                continue
            kind = node.get("@type")
            kinds = kind if isinstance(kind, list) else [kind]
            if "Product" in kinds and str(node.get("sku") or "").upper() == item["sku"]:
                out["matchedProduct"] = True
                offers = node.get("offers") or []
                if isinstance(offers, dict):
                    offers = [offers]
                if not isinstance(offers, list):
                    continue
                for o in offers[:20]:
                    if not isinstance(o, dict):
                        continue
                    p = o.get("price")
                    # Keep currency attached to observed product only,
                    # never imply same-offer identity from schema.org alone.
                    out["matchedOfferAmounts"].append({
                        "currency": str(o.get("priceCurrency") or "")[:10],
                        "priceCents": cents(p),
                    })
            for key in ("@graph", "mainEntity", "itemListElement"):
                if key in node:
                    stack.append(node[key])
    return out, soup


try:
    halted = False
    for index, query in enumerate(QUERIES):
        if halted:
            break
        if index > 0:
            time.sleep(2)
        case = {"query": query, "sourceMarket": "AE", "publishable": False}
        with requests.Session(impersonate="chrome") as session:
            w, warm = fetch(session, BASE + "/uae-en/", "warmup")
            case["warmup"] = w
            if warm is None:
                case["failure"] = "WARMUP_INACCESSIBLE"
                halted = True
            else:
                p, plp = fetch(
                    session, BASE + "/uae-en/search/?" + urlencode({"q": query}),
                    "search"
                )
                case["plp"] = p
                if plp is None:
                    case["failure"] = "SEARCH_INACCESSIBLE"
                    halted = True
                else:
                    item = choose(plp, query)
                    if item is None:
                        case["failure"] = "NO_VALID_SOURCE_OFFER_LINK"
                        halted = True
                    else:
                        case["selectedSku"] = item["sku"]
                        case["plpPrice"] = item["plpPrice"]
                        case["offerCodeHash"] = hashlib.sha256(
                            item["offerCode"].encode("utf8")
                        ).hexdigest()
                        d, pdp = fetch(session, item["url"], "offer_linked_pdp")
                        case["pdp"] = d
                        if pdp is None:
                            case["failure"] = "PDP_INACCESSIBLE"
                            halted = True
                        else:
                            seo, soup = product_seo(pdp, item)
                            case["productStructured"] = seo
                            ast = inspect_tsr_ast(
                                soup, sku=item["sku"], offer_code=item["offerCode"],
                                plp_price=item["plpPrice"],
                            )
                            current = select_source_current_offer_amount(
                                ast["candidateRecords"]
                            )
                            case["astSource"] = {
                                "nodes": ast["astNodesInspected"],
                                "matchedOfferCode": ast["offerCodePresentInTsrScript"],
                                "currentOfferPrice": current,
                            }
                            precision = interpret_price_surfaces(
                                item["plpPrice"], current["priceCents"],
                            )
                            case["precision"] = precision
                            seo_prices = [
                                o for o in seo["matchedOfferAmounts"]
                                if o["currency"] == "AED"
                                and o["priceCents"] == current["priceCents"]
                                and type(current["priceCents"]) is int
                            ]
                            case["seoPriceCurrencyCorroboratedAtProductScope"] = bool(
                                seo["matchedProduct"] and seo_prices
                            )
                            case["sameOfferCurrencyDirectlyVerified"] = False
                            case["sourcePriceSameOfferObserved"] = (
                                current["priceCents"] is not None
                            )
        REPORT["cases"].append(case)
    REPORT["sourceAcceptance"] = (
        "THREE_LIVE_PLP_AND_PDP_SOURCES_ACQUIRED"
        if len(REPORT["cases"]) == 3 and
        all(c.get("sourcePriceSameOfferObserved") is True for c in REPORT["cases"])
        else "SOURCE_OR_OFFER_EVIDENCE_INCOMPLETE"
    )
finally:
    with open(REPORT_FILE, "w", encoding="utf8") as file:
        json.dump(REPORT, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps(REPORT, ensure_ascii=False, indent=2))
    if REPORT["sourceAcceptance"] != "THREE_LIVE_PLP_AND_PDP_SOURCES_ACQUIRED":
        raise SystemExit(1)
