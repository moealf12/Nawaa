"""Isolated Noon toolchain experiment; not production/customer publishing.

One direct HTTPS request and one plain Chromium render, max. 403/429 are
recorded as access refusal; no proxy, retries, fingerprint rotation, or
challenge circumvention. Stealth v2 is verified with local static HTML only.
"""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import re
import time
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

from bs4 import BeautifulSoup
from curl_cffi import requests
from playwright.sync_api import sync_playwright

SEARCH = "https://www.noon.com/saudi-en/search/?q=Laptop"
MAX_HTML = 8_000_000
SKU_PATH = re.compile(r"^/saudi-en/(?:[a-z0-9-]{2,320}/)?(N\d{8}[AV]|Z[A-Z0-9]{20}Z)/p/?$", re.I)
PRICE_PATTERN = re.compile(r"^(?:SAR|SR|ر\.س)?\s*(\d{1,8}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:SAR|SR|ر\.س)?$", re.I)


def strict_price(raw):
    """Only accept a complete dedicated price field, never snippets/model IDs."""
    if not isinstance(raw, str) or "%" in raw:
        return None
    match = PRICE_PATTERN.fullmatch(raw.strip())
    if not match:
        return None
    try:
        price = Decimal(match.group(1).replace(",", ""))
        return str(price) if Decimal("0.50") <= price <= Decimal("1000000") else None
    except (InvalidOperation, ValueError):
        return None


def merchant_identity(raw):
    try:
        uri = urlsplit(str(raw))
        if uri.scheme != "https" or uri.hostname not in ("www.noon.com", "noon.com"):
            return None
        if uri.username or uri.password or uri.port not in (None, 443):
            return None
        match = SKU_PATH.fullmatch(uri.path)
        if not match:
            return None
        return match.group(1).upper()
    except (ValueError, TypeError):
        return None


def parse_source_html(html, query="Laptop"):
    """Diagnostic-only evidence from exact first-party search card ownership."""
    if not isinstance(html, str) or not 0 < len(html) <= MAX_HTML:
        return {"status": "INVALID_HTML", "cards": 0, "unique_offers": 0, "conflicts": 0}
    soup = BeautifulSoup(html, "lxml")
    heading = soup.find("h1")
    if not heading or heading.get_text(" ", strip=True).casefold() != query.casefold():
        return {"status": "SEARCH_CONTEXT_NOT_ATTESTED", "cards": 0, "unique_offers": 0, "conflicts": 0}
    observed = {}
    cards = 0
    for link in soup.find_all("a", href=True, limit=350):
        href = link.get("href", "")
        full_url = href if href.startswith("https://") else "https://www.noon.com" + href
        sku = merchant_identity(full_url)
        if not sku:
            continue
        name = link.select_one('[data-qa="plp-product-box-name"]')
        amount = link.select_one('[data-qa="plp-product-box-price"] strong[class*="amount"]')
        img = link.find("img", src=True)
        if not name or not amount or not img:
            continue
        title = name.get_text(" ", strip=True)
        amount_value = strict_price(amount.get_text(" ", strip=True))
        image_uri = urlsplit(str(img.get("src")))
        if len(title) < 4 or not amount_value or image_uri.hostname != "f.nooncdn.com" or image_uri.scheme != "https":
            continue
        cards += 1
        uri = urlsplit(full_url)
        from urllib.parse import parse_qs
        offers = parse_qs(uri.query, keep_blank_values=True).get("o", [])
        offer = offers[0] if len(offers) == 1 and re.fullmatch("[a-z0-9-]{1,100}", offers[0], re.I) else ""
        key = (sku, offer)
        observed.setdefault(key, set()).add(amount_value)
    conflicts = sum(len(values) > 1 for values in observed.values())
    return {"status": "SOURCE_CARD_EVIDENCE" if observed else "NO_SOURCE_CARDS",
            "cards": cards, "unique_offers": len(observed) - conflicts, "conflicts": conflicts,
            "customer_publishable": False}


def page_fingerprint(html):
    source = html[:MAX_HTML]
    lower = source.lower()
    return {"html_chars": len(source), "has_next_data": "__NEXT_DATA__" in source,
            "product_id_marker": bool(SKU_PATH.search(source)),
            "has_noon_price_marker": "plp-product-box-price" in source,
            "has_product_card_marker": "plp-product-box-name" in source,
            "possible_challenge": any(x in lower for x in ("captcha", "access denied", "verify you are human"))}


def toolchain_versions():
    packages = {}
    for dist in ("curl_cffi", "playwright", "playwright-stealth", "beautifulsoup4", "lxml"):
        try:
            packages[dist] = importlib.metadata.version(dist)
        except importlib.metadata.PackageNotFoundError:
            packages[dist] = "NOT_INSTALLED"
    try:
        from playwright_stealth import stealth_sync  # type: ignore
        packages["legacy_stealth_sync"] = "AVAILABLE"
    except ImportError:
        packages["legacy_stealth_sync"] = "NOT_AVAILABLE"
    try:
        from playwright_stealth import Stealth
        packages["modern_stealth_class"] = "AVAILABLE"
    except ImportError:
        packages["modern_stealth_class"] = "NOT_AVAILABLE"
    return packages


def test_stealth_on_local_fixture():
    """Exercise installed package without using stealth to evade a retailer 403."""
    try:
        from playwright_stealth import Stealth
        with Stealth().use_sync(sync_playwright()) as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.set_content("<html><h1>Offline fixture</h1></html>")
                return {"status": "PASS" if page.locator("h1").inner_text() == "Offline fixture" else "FAILED"}
            finally:
                browser.close()
    except Exception as exc:
        return {"status": "FAILED", "error_class": type(exc).__name__}


def curl_probe(url):
    started = time.monotonic()
    try:
        with requests.Session(timeout=12.0, retry=0, allow_redirects=False, impersonate="chrome120") as session:
            result = session.get(url, headers={"Accept": "text/html", "Accept-Language": "en-SA,en;q=0.9"})
        status = int(result.status_code)
        result_url = urlsplit(str(result.url))
        if result_url.hostname != "www.noon.com":
            return {"status": "UNEXPECTED_DOMAIN", "http_status": status}
        data = {"status": "HTTP_" + str(status), "http_status": status,
                "elapsed_ms": int((time.monotonic() - started) * 1000)}
        if status == 200:
            data["html"] = page_fingerprint(result.text)
            data["parsed"] = parse_source_html(result.text)
        return data
    except Exception as exc:
        return {"status": "REQUEST_EXCEPTION", "class": type(exc).__name__,
                "curl_code": getattr(exc, "code", None),
                "elapsed_ms": int((time.monotonic() - started) * 1000)}


def chromium_probe(url):
    started = time.monotonic()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(locale="en-SA", viewport={"width": 1366, "height": 768})
                try:
                    page = context.new_page()
                    response = page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    http_status = response.status if response else None
                    data = {"http_status": http_status, "elapsed_ms": int((time.monotonic()-started)*1000)}
                    if http_status != 200:
                        data["status"] = "HTTP_" + str(http_status) if http_status else "NO_HTTP_RESPONSE"
                        return data
                    page.wait_for_timeout(1200)
                    html = page.content()
                    data["status"] = "HTTP_200"
                    data["html"] = page_fingerprint(html)
                    data["parsed"] = parse_source_html(html)
                    return data
                finally:
                    context.close()
            finally:
                browser.close()
    except Exception as exc:
        return {"status": "BROWSER_EXCEPTION", "class": type(exc).__name__,
                "elapsed_ms": int((time.monotonic() - started) * 1000)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    print(json.dumps({"stage": "versions", **toolchain_versions()}, ensure_ascii=False))
    print(json.dumps({"stage": "local_stealth", **test_stealth_on_local_fixture()}, ensure_ascii=False))
    if args.live:
        print(json.dumps({"stage": "noon_curl", **curl_probe(SEARCH)}, ensure_ascii=False))
        print(json.dumps({"stage": "noon_chromium", **chromium_probe(SEARCH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
