#!/usr/bin/env python3
"""Isolated, live AliExpress public-HTML evidence probe for NAWAA.

One robots check, one uncredentialed search, optional one PDP verification.
Never reports an anti-bot challenge, redirect or network error as empty stock.
No proxies, secrets, token replay, CAPTCHA solving, or customer publication.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import quote, urlsplit, urljoin
from urllib.robotparser import RobotFileParser

from bs4 import BeautifulSoup
from curl_cffi import requests

ORIGIN = "https://www.aliexpress.com"
SEARCH_HOSTS = frozenset({"www.aliexpress.com", "ar.aliexpress.com"})
USER_AGENT = "NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)"
MAX_HTML = 5_000_000
MAX_JSON_SCAN = 2_500_000
MAX_CANDIDATES = 180
ID = re.compile(r"^\d{10,20}$")
VALID_QUERY_ID = re.compile(r"^[a-z0-9-]{2,36}$")
CHALLENGE = re.compile(
    r"(?:_____tmd_____|/punish(?:/|\b)|g-recaptcha|h-captcha|"
    r"captcha-container|verify you are human|robot check|security verification)",
    re.I,
)


def exact_price(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    raw = str(value).strip()
    if not re.fullmatch(r"(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?", raw):
        return None
    try:
        amount = Decimal(raw)
        if not amount.is_finite() or amount <= 0 or amount >= 10_000_000:
            return None
        return str(amount.quantize(Decimal("0.01")))
    except InvalidOperation:
        return None


def product_link(raw, expected_id):
    if not isinstance(raw, str) or len(raw) > 2400 or not ID.fullmatch(str(expected_id)):
        return None
    try:
        target = urlsplit(urljoin(ORIGIN, raw if not raw.startswith("//") else "https:" + raw))
        if (target.scheme != "https" or target.username or target.password
                or target.port not in (None, 443)
                or not re.fullmatch(r"(?:(?:www|m|ar)\.)?aliexpress\.(?:com|us)", target.hostname or "")):
            return None
        match = re.fullmatch(r"/item/(\d{10,20})\.html/?", target.path)
        if not match or match.group(1) != str(expected_id):
            return None
        return "https://" + target.netloc + target.path
    except ValueError:
        return None


def product_image(raw):
    if not isinstance(raw, str) or len(raw) > 2048:
        return None
    try:
        candidate = ("https:" + raw) if raw.startswith("//") else raw
        u = urlsplit(candidate)
        if (u.scheme == "https" and u.username is None and u.password is None
                and u.port in (None, 443)
                and (u.hostname or "").lower().endswith(".alicdn.com")
                and u.path and u.path != "/"):
            return candidate
    except ValueError:
        pass
    return None


def balanced_json(source, at, cap=MAX_JSON_SCAN):
    """Extract a JSON object using quote-aware brace matching; never eval JS."""
    level = 0
    quoted = False
    escaped = False
    for cursor in range(at, min(len(source), at + cap)):
        char = source[cursor]
        if escaped:
            escaped = False
        elif quoted and char == "\\":
            escaped = True
        elif char == '"':
            quoted = not quoted
        elif not quoted:
            if char == "{":
                level += 1
            elif char == "}":
                level -= 1
                if level == 0:
                    try:
                        value = json.loads(source[at: cursor + 1])
                        return value if isinstance(value, dict) else None
                    except (ValueError, UnicodeError):
                        return None
    return None


def embedded_search(html):
    for found in list(re.finditer(r"_dida_config_\._init_data_\s*=", html))[:3]:
        next_slice = html[found.end(): found.end() + 300]
        marker = re.search(r'(?:["\x27]?data["\x27]?\s*:)\s*\{', next_slice)
        if marker:
            brace = found.end() + marker.end() - 1
            state = balanced_json(html, brace)
            if state and isinstance(state.get("root"), dict):
                return state
    # Some rendered pages emit init-data markers rather than a JS assignment.
    start = html.find("init-data-start")
    end = html.find("init-data-end", start + 1) if start >= 0 else -1
    if start >= 0 and end > start:
        segment = html[start:end]
        marker = re.search(r'(?:["\x27]?data["\x27]?\s*:)\s*\{', segment)
        if marker:
            state = balanced_json(segment, marker.end() - 1)
            if state and isinstance(state.get("root"), dict):
                return state
    return None


def normalize_query(raw):
    return " ".join(str(raw).casefold().split())


def parsed_search_cards(html, query):
    facts = {"parser": None, "sourceItems": 0, "rejected": {},
             "accepted": 0, "explicitCurrency": 0, "priceRanges": 0,
             "productImages": 0, "productLinks": 0, "samples": [],
             "markupSignals": {
                 "didaAssignments": html.count("_dida_config_._init_data_"),
                 "initDataTokens": html.count("_init_data_"),
                 "productV3Tokens": html.count("productV3"),
                 "redirectedIdTokens": html.count("redirectedId"),
                 "productDetailUrlTokens": html.count("productDetailUrl"),
                 "itemListTokens": html.count("itemList"),
                 "searchResultTokens": html.count("searchResult"),
                 "htmlScriptElements": html.count("<script"),
                 "jsonLdElements": html.count("application/ld+json"),
                 "itemLinks": len(re.findall(r"/item/\d{10,20}\.html", html)),
             }}
    soup = BeautifulSoup(html, "html.parser")
    valid_links = {}
    for anchor in soup.select('a[href*="/item/"]')[:550]:
        href = anchor.get("href") or ""
        m = re.search(r"/item/(\d{10,20})\.html", href)
        if m and m.group(1) not in valid_links:
            url = product_link(href, m.group(1))
            if url:
                valid_links[m.group(1)] = url

    state = embedded_search(html)
    raw_items = []
    if state:
        try:
            raw_items = state["root"]["fields"]["mods"]["itemList"]["content"]
        except (KeyError, TypeError):
            raw_items = []
        if isinstance(raw_items, list):
            facts["parser"] = "ALIEXPRESS_EMBEDDED_INIT_DATA"
    if not isinstance(raw_items, list):
        raw_items = []

    seen = set()
    valid_tokens = [t for t in normalize_query(query).split(" ") if len(t) >= 2]
    cards = []

    def reject(reason):
        facts["rejected"][reason] = facts["rejected"].get(reason, 0) + 1

    for item in raw_items[:MAX_CANDIDATES]:
        facts["sourceItems"] += 1
        if not isinstance(item, dict):
            reject("ITEM_NOT_OBJECT")
            continue
        pid = str(item.get("productId") or item.get("redirectedId") or "")
        title_field = item.get("title")
        title = (title_field.get("displayTitle") or title_field.get("seoTitle") or ""
                 if isinstance(title_field, dict) else "")
        title = BeautifulSoup(str(title), "html.parser").get_text(" ", strip=True)
        title = " ".join(title.split())
        if not ID.fullmatch(pid) or not 3 <= len(title) <= 250:
            reject("INVALID_ID_OR_TITLE")
            continue
        if valid_tokens and not any(token in normalize_query(title) for token in valid_tokens):
            reject("QUERY_NOT_RELEVANT")
            continue
        if pid in seen:
            reject("DUPLICATE_ID")
            continue
        prices = item.get("prices")
        sale = prices.get("salePrice") if isinstance(prices, dict) else None
        if not isinstance(sale, dict):
            reject("CURRENT_SALE_PRICE_MISSING")
            continue
        price = exact_price(sale.get("minPrice"))
        maximum = exact_price(sale.get("maxPrice")) if sale.get("maxPrice") is not None else None
        currency = sale.get("currencyCode")
        if (not price or not isinstance(currency, str)
                or not re.fullmatch("[A-Z]{3}", currency)):
            reject("PRICE_OR_EXPLICIT_CURRENCY_MISSING")
            continue
        if maximum and Decimal(maximum) < Decimal(price):
            reject("INVALID_VARIANT_PRICE_RANGE")
            continue
        image_obj = item.get("image")
        image = product_image(image_obj.get("imgUrl")) if isinstance(image_obj, dict) else None
        if not image:
            reject("TRUSTED_IMAGE_MISSING")
            continue
        source_url = item.get("productDetailUrl") or item.get("productUrl")
        url = product_link(source_url, pid) or valid_links.get(pid)
        if not url:
            reject("SOURCE_PDP_LINK_IDENTITY_UNVERIFIED")
            continue
        seen.add(pid)
        facts["explicitCurrency"] += 1
        facts["productImages"] += 1
        facts["productLinks"] += 1
        if maximum and maximum != price:
            facts["priceRanges"] += 1
        cards.append({
            "productId": pid, "title": title, "sourceUrl": url,
            "image": image, "priceOriginal": price, "currency": currency,
            "maxVariantPrice": maximum,
            "priceKind": "SEARCH_CARD_MINIMUM_VARIANT_UNVERIFIED",
            "market": "ALIEXPRESS_GLOBAL", "canShipToSaudi": None,
            "pdpPriceVerified": False, "customerPublishable": False,
        })
    facts["accepted"] = len(cards)
    facts["samples"] = cards[:3]
    return facts, cards


def classify_html(text):
    if CHALLENGE.search(text[:MAX_HTML]):
        return "CHALLENGE_PAGE_NOT_PRODUCT_EVIDENCE"
    if "_dida_config_" not in text and len(text) < 15000:
        return "THIN_OR_UNHYDRATED_SEARCH_HTML"
    return "SEARCH_HTML_RECEIVED"


def fetch_html(session, url, label, report):
    started = time.monotonic()
    report["requestsAttempted"] += 1
    stage = {"step": label}
    content = None
    try:
        response = session.get(
            url, timeout=15, allow_redirects=False,
            headers={"accept": "text/html,application/xhtml+xml",
                     "accept-language": "ar-SA,ar;q=0.9,en;q=0.5",
                     "user-agent": USER_AGENT},
        )
        body = response.content
        stage["status"] = response.status_code
        stage["contentType"] = str(response.headers.get("content-type") or "")[:80]
        stage["responseBytes"] = len(body)
        final = urlsplit(str(response.url))
        stage["originPinned"] = final.hostname == urlsplit(url).hostname
        if response.status_code == 200 and stage["originPinned"] and (
            "html" in stage["contentType"].lower()) and 0 < len(body) <= MAX_HTML:
            content = body.decode("utf-8", errors="replace")
            stage["state"] = classify_html(content)
            if stage["state"] == "CHALLENGE_PAGE_NOT_PRODUCT_EVIDENCE":
                content = None
        else:
            stage["state"] = "HTTP_OR_CONTENT_REJECTED"
    except Exception as exc:
        stage["state"] = "TRANSPORT_UNAVAILABLE"
        stage["exceptionType"] = type(exc).__name__[:60]
    stage["elapsedMs"] = round((time.monotonic() - started) * 1000)
    report["stages"].append(stage)
    return content


def robots_allowed(session, target, report):
    host = urlsplit(target).hostname
    if host not in SEARCH_HOSTS:
        return False
    url = "https://" + host + "/robots.txt"
    started = time.monotonic()
    report["requestsAttempted"] += 1
    stage = {"step": "robots_policy"}
    permitted = False
    try:
        response = session.get(url, timeout=12, allow_redirects=False,
                               headers={"user-agent": USER_AGENT, "accept": "text/plain"})
        stage["status"] = response.status_code
        stage["responseBytes"] = len(response.content)
        if (response.status_code == 200 and 0 < len(response.content) <= 150000
                and urlsplit(str(response.url)).hostname == host):
            parser = RobotFileParser()
            parser.parse(response.text.splitlines())
            permitted = parser.can_fetch(USER_AGENT.split("/", 1)[0], target)
            stage["state"] = "ROBOTS_ALLOWED" if permitted else "ROBOTS_DISALLOWED"
        else:
            stage["state"] = "ROBOTS_UNAVAILABLE"
    except Exception as exc:
        stage["state"] = "ROBOTS_UNAVAILABLE"
        stage["exceptionType"] = type(exc).__name__[:60]
    stage["elapsedMs"] = round((time.monotonic() - started) * 1000)
    report["stages"].append(stage)
    return permitted


def main():
    query = os.getenv("ALIEXPRESS_SEARCH_QUERY", "").strip()
    query_id = os.getenv("ALIEXPRESS_QUERY_ID", "").strip()
    if not (2 <= len(query) <= 100) or any(ord(x) < 32 for x in query):
        raise SystemExit("INVALID_QUERY")
    if not VALID_QUERY_ID.fullmatch(query_id):
        raise SystemExit("INVALID_QUERY_ID")
    search_host = os.getenv("ALIEXPRESS_SEARCH_HOST", "www.aliexpress.com").strip()
    if search_host not in SEARCH_HOSTS:
        raise SystemExit("INVALID_SEARCH_HOST")
    slug = quote("-".join(query.split()), safe="-")
    search_url = "https://" + search_host + "/w/wholesale-" + slug + ".html"
    report = {
        "schema": "nawaa.aliexpress.live-html-proof.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat(),
        "headSha": os.getenv("HEAD_SHA", ""), "queryId": query_id,
        "query": query, "source": "aliexpress-cn",
        "searchHost": search_host,
        "requestsAttempted": 0, "retries": 0, "proxyUsed": False,
        "captchaSolved": False, "customerPublishable": False,
        "stages": [], "conclusion": "NOT_STARTED",
    }
    try:
        with requests.Session(impersonate="chrome") as session:
            if not robots_allowed(session, search_url, report):
                report["conclusion"] = "SOURCE_POLICY_NOT_AVAILABLE"
            else:
                html = fetch_html(session, search_url, "search_html_live", report)
                if html is None:
                    report["conclusion"] = "SEARCH_HTML_NOT_VERIFIED"
                else:
                    stats, cards = parsed_search_cards(html, query)
                    report["extraction"] = stats
                    report["conclusion"] = (
                        "LIVE_ALIEXPRESS_PRODUCT_CARDS_EXTRACTED" if cards else
                        "SEARCH_HTML_WITHOUT_TRUSTED_PRICE_IMAGE_LINK_CARDS"
                    )
    except Exception as exc:
        report["conclusion"] = "SCRIPT_FAILURE"
        report["exceptionType"] = type(exc).__name__[:60]
    filename = "aliexpress-live-" + query_id + ".json"
    with open(filename, "w", encoding="utf-8") as out:
        json.dump(report, out, ensure_ascii=False, indent=2)
        out.write("\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["conclusion"] != "LIVE_ALIEXPRESS_PRODUCT_CARDS_EXTRACTED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
