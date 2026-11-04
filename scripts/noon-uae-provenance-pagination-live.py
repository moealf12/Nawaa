#!/usr/bin/env python3
"""Noon UAE price-currency provenance + pagination + PDP live evidence gate.

Uses exactly the session transport proven by the Noon UAE card acquisition
tests. Public uncredentialed source only. No proxy, retries, WAF bypass,
customer publishing or inventory writes. Does not infer AED from locale alone.
"""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests
from noon_uae_price_policy import assess_offer

BASE = "https://www.noon.com"
SEARCH = BASE + "/uae-en/search/"
QUERY = "PlayStation 5"
OUT = "noon-uae-provenance-pagination-live.json"
SKU_PATH = re.compile(r"/(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
MAX_BYTES = 5_000_000
CURRENCY = re.compile(r"(?<![A-Z])AED(?![A-Z])|د[.]?\s*إ", re.I)
REPORT = {
    "schema": "nawaa.noon-ae.price-pagination-pdp.v1",
    "sha": os.getenv("PULL_REQUEST_HEAD_SHA", ""),
    "observedUTC": datetime.now(timezone.utc).isoformat(),
    "query": QUERY,
    "market": "AE",
    "requestsAttempted": 0,
    "noRetry": True,
    "noProxy": True,
    "customerPublishable": False,
    "pdpPriceVerified": False,
    "currencyVerifiedPerOffer": False,
    "paginationVerified": False,
    "observations": [],
    "decision": "NOT_RUN",
}


def problem(exc):
    name = type(exc).__name__.lower()
    message = str(exc).lower()
    if any(x in name for x in ("typeerror", "attributeerror", "nameerror")):
        return "CLIENT_CODE_ERROR"
    if "timeout" in name or "timeout" in message or "timed out" in message:
        return "TIMEOUT"
    if any(x in message for x in ("http2", "http/2", "errcode: 92")):
        return "HTTP2_PROTOCOL_ERROR"
    return "NETWORK_EXCEPTION"


def same_origin(url):
    try:
        u = urlsplit(url)
        return (u.scheme == "https" and u.hostname == "www.noon.com"
                and u.username is None and u.password is None
                and u.port in (None, 443))
    except ValueError:
        return False


def source_get(session, url, step):
    start = time.monotonic()
    result = {"step": step}
    body = None
    REPORT["requestsAttempted"] += 1
    try:
        if not same_origin(url):
            result["status"] = "REFUSED_UNPINNED_ORIGIN"
            return result, None
        response = session.get(
            url, timeout=12, allow_redirects=False,
            headers={"accept": "text/html,application/xhtml+xml"},
        )
        result["httpStatus"] = response.status_code
        result["responseBytes"] = len(response.content)
        result["httpVersion"] = str(response.http_version)[:15]
        result["contentType"] = str(
            response.headers.get("content-type") or "")[:65]
        if (response.status_code == 200
                and result["contentType"].startswith("text/html")
                and len(response.content) <= MAX_BYTES
                and same_origin(str(response.url))):
            body = response.content
            result["sha256"] = hashlib.sha256(body).hexdigest()
            result["status"] = "HTML_RECEIVED"
        elif response.status_code == 403:
            result["status"] = "ACCESS_DENIED"
        elif response.status_code == 429:
            result["status"] = "RATE_LIMITED"
        else:
            result["status"] = "HTTP_OR_CONTENT_REJECTED"
    except Exception as exc:
        result["status"] = problem(exc)
        result["exceptionType"] = type(exc).__name__[:50]
    finally:
        result["elapsedMs"] = round(1000 * (time.monotonic() - start))
        REPORT["observations"].append(result)
    return result, body


def product_link(href):
    if not isinstance(href, str) or len(href) > 3000:
        return None
    url = urljoin(BASE, href)
    if not same_origin(url):
        return None
    u = urlsplit(url)
    if not u.path.startswith("/uae-en/"):
        return None
    match = SKU_PATH.search(u.path)
    if not match:
        return None
    offer = parse_qs(u.query).get("o", [])
    offer_code = (
        offer[0] if len(offer) == 1 and
        re.fullmatch(r"[a-zA-Z0-9-]{1,100}", offer[0])
        else None
    )
    return {"sku": match.group(1).upper(), "url": url, "offer": offer_code}


def price_info(anchor):
    root = anchor.select_one('[data-qa="plp-product-box-price"]')
    if root is None:
        return False, False
    node = root.select_one('strong[class*="amount"], strong')
    if node is None:
        return False, False
    raw = node.get_text(" ", strip=True)
    # Numeric text existence is evidence of a displayed amount, not currency.
    normalized = raw.replace("\u00a0", "").replace(",", "").strip()
    original_valid = bool(re.fullmatch(
        r"(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?",
        raw.replace("\u00a0", "").strip(),
    ))
    amount_value = None
    if original_valid:
        try:
            value = Decimal(normalized)
            if value > 0 and value <= Decimal("99999999.99"):
                amount_value = str(value.quantize(Decimal("0.01")))
        except (InvalidOperation, ValueError):
            pass
    label = " ".join(
        str(x) for x in (
            node.get_text(" ", strip=True),
            root.get("aria-label"),
            root.get("data-currency"),
            anchor.get("data-currency"),
        ) if x is not None
    )
    return amount_value, bool(CURRENCY.search(label))


def describe_page(body, expected_query, page_number):
    soup = BeautifulSoup(body, "html.parser")
    lang = str(soup.html.get("lang") or "") if soup.html else ""
    h1 = soup.select_one("h1")
    heading = h1.get_text(" ", strip=True) if h1 else ""
    matches = " ".join(heading.casefold().split()) == " ".join(
        expected_query.casefold().split()
    )
    page_valid = (lang.casefold() == "en-ae" and matches)
    skus = set()
    linked_offers = []
    title_and_amount = 0
    per_card_currency = 0
    for anchor in soup.select('a[href*="/p/"]')[:300]:
        item = product_link(anchor.get("href"))
        if not item:
            continue
        title = anchor.select_one('[data-qa="plp-product-box-name"]')
        if title is None or not title.get_text(" ", strip=True):
            continue
        amount, explicit = price_info(anchor)
        if not amount:
            continue
        title_and_amount += 1
        per_card_currency += int(explicit)
        skus.add(item["sku"])
        if item["offer"] and len(linked_offers) < 2:
            item["plpPriceObserved"] = amount
            linked_offers.append(item)
    meta_currencies = [
        str(tag.get("content") or "")[:20] for tag in
        soup.select(
            'meta[itemprop="priceCurrency"],'
            'meta[property="product:price:currency"],'
            'meta[name="currency"]'
        )[:15]
    ]
    jsonld_currencies = []
    for script in soup.select('script[type="application/ld+json"]')[:50]:
        raw = script.string or script.get_text()
        if not raw or len(raw) > 200_000:
            continue
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            continue
        queue = [obj]
        count = 0
        while queue and count < 300:
            count += 1
            value = queue.pop()
            if isinstance(value, list):
                queue.extend(value[:50])
            elif isinstance(value, dict):
                for key in ("@graph", "itemListElement", "item", "offers"):
                    if key in value:
                        queue.append(value[key])
                if value.get("priceCurrency"):
                    jsonld_currencies.append({
                        "currency": str(value["priceCurrency"])[:12],
                        "hasSku": bool(value.get("sku")),
                        "hasOfferPrice": "price" in value,
                    })
    page_two_links = []
    for a in soup.select("a[href]")[:2500]:
        href = a.get("href")
        if not isinstance(href, str):
            continue
        u = urlsplit(urljoin(BASE, href))
        if (same_origin(u.geturl()) and
                u.path.rstrip("/") == "/uae-en/search" and
                parse_qs(u.query).get("page", []) == ["2"]):
            page_two_links.append({
                "path": u.path[:100],
                "params": sorted(parse_qs(u.query).keys()),
            })
    return {
        "page": page_number,
        "documentLang": lang,
        "h1": heading[:100],
        "queryMatches": matches,
        "marketContextValid": page_valid,
        "linkSkuCount": len(skus),
        "cardTitleWithNumericPrice": title_and_amount,
        "cardExplicitAedLabelCount": per_card_currency,
        "documentMetaCurrencies": meta_currencies,
        "documentJsonLdCurrencyEvidence": jsonld_currencies[:12],
        "pageTwoLinkCount": len(page_two_links),
        "pageTwoLinksSample": page_two_links[:2],
        "skus": skus,
        "linkedOffers": linked_offers,
    }



def inspect_pdp_structured_data(body, expected_sku, expected_offer, plp_price):
    """Inspect structured product/offer evidence; never infer buybox from SEO."""
    soup = BeautifulSoup(body, "html.parser")
    result = {
        "pageLang": str(soup.html.get("lang") if soup.html else "")[:20],
        "jsonLdScriptCount": 0,
        "jsonLdDecodeErrors": 0,
        "typeCounts": {},
        "matchedProductSku": False,
        "matchedSkuProductCount": 0,
        "currencyInMatchedSkuOffer": [],
        "matchedSkuOfferPriceEvidence": [],
        "matchedOfferCodeInStructuredData": False,
        "pdpMatchesPlpAmountWithoutOfferProof": False,
        "pdpPriceVerified": False,
    }
    if result["pageLang"].casefold() not in ("en-ae", "ar-ae"):
        result["state"] = "PDP_MARKET_LOCALE_INVALID"
        return result
    for tag in soup.select('script[type="application/ld+json"]')[:40]:
        raw = tag.string or tag.get_text()
        if not raw or len(raw) > 250_000:
            continue
        result["jsonLdScriptCount"] += 1
        try:
            obj = json.loads(raw)
        except (TypeError, ValueError):
            result["jsonLdDecodeErrors"] += 1
            continue
        queue = [obj]
        budget = 0
        while queue and budget < 1000:
            budget += 1
            node = queue.pop()
            if isinstance(node, list):
                queue.extend(node[:100])
                continue
            if not isinstance(node, dict):
                continue
            typ = node.get("@type")
            types = typ if isinstance(typ, list) else [typ]
            for name in types:
                if isinstance(name, str):
                    result["typeCounts"][name[:35]] = min(
                        1000, result["typeCounts"].get(name[:35], 0) + 1
                    )
            for k in ("@graph", "item", "itemListElement", "mainEntity"):
                if k in node:
                    queue.append(node[k])
            if "Product" not in types:
                continue
            candidate_sku = str(node.get("sku") or node.get("productID") or "").upper()
            if candidate_sku != expected_sku:
                continue
            result["matchedProductSku"] = True
            result["matchedSkuProductCount"] += 1
            offer_nodes = node.get("offers") or []
            if isinstance(offer_nodes, dict):
                offer_nodes = [offer_nodes]
            if not isinstance(offer_nodes, list):
                continue
            for offer in offer_nodes[:50]:
                if not isinstance(offer, dict):
                    continue
                currency = str(offer.get("priceCurrency") or "").upper().strip()
                offer_price = offer.get("price")
                offer_link = offer.get("url")
                if currency and currency not in result["currencyInMatchedSkuOffer"]:
                    result["currencyInMatchedSkuOffer"].append(currency[:12])
                price_valid = None
                if isinstance(offer_price, (str, int, float)) and not isinstance(offer_price, bool):
                    try:
                        value = Decimal(str(offer_price))
                        if value.is_finite() and Decimal("0") < value < Decimal("10000000"):
                            price_valid = str(value.quantize(Decimal("0.01")))
                    except (InvalidOperation, ValueError):
                        pass
                verdict = assess_offer(
                    requested_sku=expected_sku,
                    product_sku=candidate_sku,
                    plp_price=plp_price,
                    pdp_price=price_valid,
                    currency=currency,
                    requested_offer_code=expected_offer,
                    offer_url=offer_link,
                )
                result["matchedOfferCodeInStructuredData"] |= verdict[
                    "sameOfferIdentity"
                ]
                if len(result["matchedSkuOfferPriceEvidence"]) < 20:
                    result["matchedSkuOfferPriceEvidence"].append({
                        "currency": currency[:12] or None,
                        "amount": price_valid,
                        "offerLinkMatches": verdict["sameOfferIdentity"],
                        "deltaCentsVsPlp": verdict["deltaCents"],
                        "verificationStatus": verdict["decision"],
                        "type": str(offer.get("@type") or "")[:30],
                    })
                if verdict["aedFromProductOffer"] and verdict["deltaCents"] == 0:
                    result["pdpMatchesPlpAmountWithoutOfferProof"] = True
                if verdict["verified"]:
                    result["pdpPriceVerified"] = True
    result["state"] = (
        "PDP_OFFER_PRICE_CURRENCY_IDENTITY_VERIFIED"
        if result["pdpPriceVerified"]
        else "PDP_PRODUCT_MATCHED_OFFER_PARITY_UNVERIFIED"
        if result["matchedProductSku"]
        else "PDP_NO_STRUCTURED_SKU_IDENTITY"
    )
    return result


def summarize_page(page):
    return {
        key: value for key, value in page.items()
        if key not in ("skus", "linkedOffers")
    }


try:
    with requests.Session(impersonate="chrome") as session:
        warm, warm_body = source_get(session, BASE + "/uae-en/", "warmup")
        if warm_body is None:
            REPORT["decision"] = "WARMUP_NOT_AVAILABLE"
        else:
            url1 = SEARCH + "?" + urlencode({"q": QUERY})
            first, first_body = source_get(session, url1, "first_search_page")
            if first_body is None:
                REPORT["decision"] = "FIRST_SEARCH_PAGE_NOT_AVAILABLE"
            else:
                p1 = describe_page(first_body, QUERY, 1)
                first["content"] = summarize_page(p1)
                if not p1["marketContextValid"] or not p1["skus"]:
                    REPORT["decision"] = "FIRST_PAGE_NOT_ATTESTED"
                else:
                    url2 = SEARCH + "?" + urlencode({"q": QUERY, "page": 2})
                    second, second_body = source_get(
                        session, url2, "second_search_page"
                    )
                    if second_body:
                        p2 = describe_page(second_body, QUERY, 2)
                        intersection = p1["skus"] & p2["skus"]
                        novel = p2["skus"] - p1["skus"]
                        second["content"] = summarize_page(p2)
                        second["skuOverlap"] = len(intersection)
                        second["novelSkuCount"] = len(novel)
                        REPORT["paginationVerified"] = bool(
                            p2["marketContextValid"] and len(novel) >= 5 and
                            len(novel) > len(intersection)
                        )
                    REPORT["perCardCurrencyExplicit"] = p1[
                        "cardExplicitAedLabelCount"
                    ]
                    REPORT["documentCurrencyMetaValues"] = p1[
                        "documentMetaCurrencies"
                    ]
                    # Market path, locale, or page-level currency are not per-SKU price
                    # evidence. Do not mark offer currency as independently verified.
                    REPORT["currencyVerifiedPerOffer"] = bool(
                        p1["cardTitleWithNumericPrice"] > 0
                        and p1["cardExplicitAedLabelCount"] ==
                            p1["cardTitleWithNumericPrice"]
                    )
                    if p1["linkedOffers"]:
                        item = p1["linkedOffers"][0]
                        product, product_body = source_get(
                            session, item["url"], "one_public_pdp_with_offer_code"
                        )
                        product["sku"] = item["sku"]
                        if product_body:
                            evidence = inspect_pdp_structured_data(
                                product_body, item["sku"], item["offer"],
                                item["plpPriceObserved"],
                            )
                            product["structuredEvidence"] = evidence
                            REPORT["pdpPriceVerified"] = evidence["pdpPriceVerified"]
                            product["state"] = evidence["state"]
                    REPORT["decision"] = (
                        "PLP_ACCESS_CONFIRMED_PAGINATION_VERIFIED"
                        if REPORT["paginationVerified"]
                        else "PLP_ACCESS_CONFIRMED_PAGINATION_UNVERIFIED"
                    )
except Exception as exc:
    REPORT["decision"] = problem(exc)
    REPORT["fatalErrorType"] = type(exc).__name__[:50]
finally:
    with open(OUT, "w", encoding="utf8") as file:
        json.dump(REPORT, file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps(REPORT, ensure_ascii=False, indent=2))
    # Fail closed if no independent page-two product evidence is obtained.
    if not REPORT["paginationVerified"]:
        raise SystemExit(1)
