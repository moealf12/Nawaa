#!/usr/bin/env python3
"""NAWAA Universal Store Scraper — public storefront search, evidence-first extraction.

One-file CLI. Uses HTTP/HTML, Shopify Predictive Search, WooCommerce Store API,
JSON-LD, Microdata, DOM cards, and optional Playwright rendering.
Does not circumvent access controls. Never returns unverified prices as verified.

Usage:
  python universal_store_scraper.py --store https://example-store.com --query 'iphone' --max 20 --browser auto

Dependencies: httpx, beautifulsoup4; playwright optional (install chromium separately).
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict, dataclass, field
from decimal import Decimal, InvalidOperation
import ipaddress
import json
import re
import socket
import sys
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit, quote
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup, Tag

USER_AGENT = "NAWAA-PublicProductIndexer/1.0 (+respect robots.txt; research contact via project site)"
CURRENCY_CODES = {"SAR", "AED", "USD", "EUR", "GBP", "KWD", "BHD", "OMR", "QAR", "EGP", "JPY", "INR", "CAD", "AUD", "TRY", "CNY", "CHF", "SEK", "NOK", "DKK", "PLN"}
CURRENCY_WORDS = {
    "﷼": "SAR", "ر.س": "SAR", "ريال": "SAR", "د.إ": "AED", "د.إ": "AED",
    "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "د.ك": "KWD",
}
CARD_SELECTORS = (
    "[itemscope][itemtype*='Product']", "li.product", "article.product", ".product-card",
    ".product-item", ".product-grid-item", ".grid-product", "[data-product-id]",
    "[data-testid*='product-card']", "[class*='productCard']", "[class*='ProductCard']",
)
PRODUCT_PATHS = ("/product/", "/products/", "/p/", "/dp/", "/item/", "/prod/")
BLOCK_PHRASES = ("verify you are human", "checking your browser", "captcha", "access denied", "unusual traffic", "security check", "robot check", "cf-challenge")


@dataclass
class Product:
    title: str
    url: str
    price: str | None = None
    currency: str | None = None
    image: str | None = None
    sku: str | None = None
    method: str = "unknown"
    source_page: str | None = None
    price_status: str = "unknown"
    issues: list[str] = field(default_factory=list)
    observed_at_utc: str | None = None


@dataclass
class Diagnostic:
    method: str
    url: str
    status: str
    found: int = 0
    detail: str | None = None
    elapsed_ms: int = 0


def clean_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    return ""


def normalized_currency(value: Any, hint: str | None = None) -> str | None:
    s = clean_str(value).upper()
    if s in CURRENCY_CODES:
        return s
    for marker, code in CURRENCY_WORDS.items():
        if marker in str(value or ""):
            return code
    for code in CURRENCY_CODES:
        if re.search(rf"(?<![A-Z]){code}(?![A-Z])", s):
            return code
    return hint if hint in CURRENCY_CODES else None


def number_price(value: Any, currency: str | None = None) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    txt = str(value).strip()
    txt = txt.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫٬", "01234567890123456789.,"))
    # Refuse ranges and 'from' prices as exact prices.
    if re.search(r"\d\s*(?:-|–|—|~|to|إلى)\s*\d", txt, re.I):
        return None
    found = re.findall(r"(?<!\w)\d[\d\s,.\u00a0]*\d|(?<!\w)\d+", txt)
    if len(found) != 1:
        return None
    number = re.sub(r"[\s\u00a0]", "", found[0])
    if "," in number and "." in number:
        separator = "," if number.rfind(",") > number.rfind(".") else "."
        grouping = "." if separator == "," else ","
        number = number.replace(grouping, "").replace(separator, ".")
    elif "," in number or "." in number:
        sep = "," if "," in number else "."
        parts = number.split(sep)
        if len(parts) > 2:
            if not all(len(x) == 3 for x in parts[1:]):
                return None
            number = "".join(parts)
        elif len(parts) == 2:
            if len(parts[1]) == 3 and len(parts[0]) >= 1:
                number = "".join(parts)
            elif len(parts[1]) in (1, 2):
                number = parts[0] + "." + parts[1]
            else:
                return None
    try:
        v = Decimal(number)
        return str(v) if v.is_finite() and v > 0 else None
    except (InvalidOperation, ValueError):
        return None


def currency_from_text(txt: str, hint: str | None = None) -> str | None:
    code = normalized_currency(txt)
    if code:
        return code
    if "$" in txt:
        return hint if hint in {"USD", "CAD", "AUD"} else None
    return hint


def host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".")


def same_store(url: str, origin: str) -> bool:
    a, b = host(url), host(origin)
    return a == b or a.removeprefix("www.") == b.removeprefix("www.")


def ensure_public_url(url: str, origin: str | None = None) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Only public HTTPS storefront addresses are accepted")
    if origin and not same_store(url, origin):
        raise ValueError("Cross-store navigation is blocked")
    domain = parsed.hostname.rstrip(".")
    if domain.lower() in {"localhost", "localhost.localdomain"} or "." not in domain:
        raise ValueError("Invalid public storefront domain")
    # Guard common SSRF targets; production should ALSO enforce egress ACLs to
    # prevent DNS rebinding, and run untrusted pages in isolated browsers.
    for info in socket.getaddrinfo(domain, None, type=socket.SOCK_STREAM):
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise ValueError("Storefront resolves to a non-public network address")
    return url


def abs_url(url: Any, base: str) -> str | None:
    if isinstance(url, dict):
        url = url.get("url") or url.get("contentUrl")
    url = clean_str(url)
    if not url or url.startswith(("data:", "javascript:", "blob:")):
        return None
    merged = urljoin(base, url)
    if urlsplit(merged).scheme != "https":
        return None
    return merged


def normalize_product_url(url: str) -> str:
    p = urlsplit(url)
    params = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
              if not (k.startswith("utm_") or k in {"gclid", "fbclid", "ref", "source"})]
    return urlunsplit((p.scheme, p.netloc.lower(), p.path.rstrip("/") or "/", urlencode(params), ""))


def product_from_mapping(data: dict, url: str, page: str, method: str, currency_hint: str | None = None) -> list[Product]:
    title = clean_str(data.get("name") or data.get("title"))
    if not title:
        return []
    product_url = abs_url(data.get("url") or data.get("@id") or url, page) or url
    image_field = data.get("image") or data.get("images")
    if isinstance(image_field, list):
        image_field = next((x for x in image_field if x), None)
    image = abs_url(image_field, page)
    offers = data.get("offers")
    if isinstance(offers, dict):
        if "offers" in offers and isinstance(offers["offers"], list):
            offers = offers["offers"]
        else:
            offers = [offers]
    elif not isinstance(offers, list):
        offers = [data]
    results = []
    for item in offers[:20]:
        if not isinstance(item, dict):
            continue
        price = item.get("price")
        if price is None:
            spec = item.get("priceSpecification")
            if isinstance(spec, dict):
                price = spec.get("price")
            elif isinstance(spec, list) and len(spec) == 1 and isinstance(spec[0], dict):
                price = spec[0].get("price")
        currency = normalized_currency(item.get("priceCurrency") or data.get("priceCurrency"), currency_hint)
        if isinstance(price, dict):
            price = price.get("value")
        value = number_price(price, currency)
        issues = []
        if not value:
            issues.append("PRICE_MISSING_OR_AMBIGUOUS")
        if not currency:
            issues.append("CURRENCY_UNVERIFIED")
        if item.get("lowPrice") is not None or item.get("highPrice") is not None:
            issues.append("AGGREGATE_PRICE_RANGE")
            value = None
        results.append(Product(
            title=title, url=abs_url(item.get("url"), page) or product_url,
            price=value if currency else None, currency=currency, image=image,
            sku=clean_str(item.get("sku") or data.get("sku")) or None,
            method=method, source_page=page,
            price_status="candidate" if value and currency else "unresolved",
            issues=issues))
    return results or [Product(title=title, url=product_url, image=image,
                               method=method, source_page=page, price_status="unresolved",
                               issues=["NO_OFFERS"])]


def jsonld_nodes(obj: Any, limit: int = 2000):
    stack = [obj]
    count = 0
    while stack and count < limit:
        node = stack.pop()
        count += 1
        if isinstance(node, list):
            stack.extend(reversed(node))
        elif isinstance(node, dict):
            yield node
            for k, val in node.items():
                if k in ("@graph", "itemListElement", "item", "mainEntity", "hasPart"):
                    stack.append(val)


def parse_jsonld(html: str, page: str) -> list[Product]:
    soup = BeautifulSoup(html, "html.parser")
    output = []
    for script in soup.select("script[type='application/ld+json']"):
        try:
            root = json.loads(script.string or script.get_text())
        except (json.JSONDecodeError, ValueError, TypeError):
            continue
        for node in jsonld_nodes(root):
            types = node.get("@type", [])
            types = [types] if isinstance(types, str) else types
            if any(clean_str(x).split("/")[-1].lower() == "product" for x in types):
                output.extend(product_from_mapping(node, page, page, "jsonld"))
    return output


def detect_currency(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    for selector in ["meta[property='product:price:currency']", "meta[itemprop='priceCurrency']",
                     "meta[property='og:price:currency']", "[itemprop='priceCurrency']"]:
        el = soup.select_one(selector)
        if el:
            curr = normalized_currency(el.get("content") or el.get("value") or el.get_text())
            if curr:
                return curr
    for regex in [r'\bShopify\.currency\.active\s*=\s*["\']([A-Z]{3})',
                  r'["\']currency_code["\']\s*:\s*["\']([A-Z]{3})',
                  r'["\']currencyCode["\']\s*:\s*["\']([A-Z]{3})']:
        match = re.search(regex, html[:300_000])
        if match and match.group(1) in CURRENCY_CODES:
            return match.group(1)
    return None


def find_image(card: Tag, base: str) -> str | None:
    tag = card.select_one("img")
    if not tag:
        return None
    for attr in ("data-src", "data-original", "data-lazy-src", "src", "srcset", "data-srcset"):
        raw = tag.get(attr)
        if raw:
            if "srcset" in attr:
                raw = raw.split(",")[0].strip().split(" ")[0]
            out = abs_url(raw, base)
            if out:
                return out
    return None


def extract_card_price(card: Tag, hint: str | None) -> tuple[str | None, str | None]:
    # Prefer current/sale price, ignoring <del> and old price labels.
    candidates = card.select("[itemprop='price'], [data-price], .sale-price, .price--sale, .price-item--sale, ins, .price, [class*='current-price']")
    for el in candidates[:12]:
        if el.find_parent(["del", "s"]):
            continue
        classes = " ".join(el.get("class", []))
        if any(w in classes.lower() for w in ("old", "regular", "compare", "was-price")):
            continue
        raw = el.get("content") or el.get("data-price") or el.get_text(" ", strip=True)
        value = number_price(raw)
        currency = currency_from_text(str(raw), hint)
        if value and currency:
            return value, currency
    return None, hint


def parse_amazon_us_cards(html: str, page: str, maximum: int) -> list[Product]:
    """Extract Amazon US search cards with ASIN-bound title, image and current price.

    This is an opt-in, layout-specific parser: only the visible Amazon US search
    tile can associate the price with the ASIN. It never assumes prices from
    recommendations, crossed-out values, or other cards.
    """
    soup = BeautifulSoup(html, "html.parser")
    results: list[Product] = []
    seen = set()
    for card in soup.select("[data-component-type='s-search-result'][data-asin]"):
        asin = clean_str(card.get("data-asin")).upper()
        if not re.fullmatch(r"[A-Z0-9]{10}", asin) or asin in seen:
            continue
        # Require a product link to the SAME ASIN; dismiss paid navigation and
        # recommendation links even when nested inside the result tile.
        anchor = next((a for a in card.select("a[href*='/dp/']")
                       if re.search(r"/dp/" + asin + r"(?:[/?]|$)", a.get("href", ""), re.I)), None)
        if anchor is None:
            continue
        title_el = card.select_one("h2")
        image_el = card.select_one("img.s-image")
        title = clean_str(title_el.get_text(" ", strip=True) if title_el else "")
        if not title and image_el is not None:
            title = clean_str(image_el.get("alt"))
        if len(title) < 7:
            continue
        # Amazon's a-text-price is normally a struck-through previous price.
        current = card.select_one("span.a-price:not(.a-text-price) span.a-offscreen")
        current_text = current.get_text(" ", strip=True) if current else ""
        explicit_usd = current_text.startswith("$") or bool(re.search(r"\bUSD\b", current_text, re.I))
        amount = number_price(current_text) if explicit_usd else None
        currency = "USD" if explicit_usd and amount else None
        image = (next((abs_url(image_el.get(attr), page) for attr in
                       ("data-src", "data-lazy-src", "src") if image_el.get(attr)), None)
                 if image_el is not None else None)
        product_url = f"https://www.amazon.com/dp/{asin}"
        seen.add(asin)
        results.append(Product(
            title=title, url=product_url, sku=asin, price=amount, currency=currency,
            image=image, method="amazon-us-html-card", source_page=page,
            price_status="candidate" if amount and image else "unresolved",
            issues=[] if amount and image else ["AMAZON_CARD_PRICE_OR_IMAGE_MISSING"],
        ))
        if len(results) >= maximum:
            break
    return results


def parse_html_cards(html: str, page: str, origin: str, maximum: int) -> list[Product]:
    if host(origin) == "www.amazon.com" or host(origin) == "amazon.com":
        amazon_cards = parse_amazon_us_cards(html, page, maximum)
        if amazon_cards or "s-search-result" in html:
            return amazon_cards
    soup = BeautifulSoup(html, "html.parser")
    hint = detect_currency(html)
    results = []
    nodes: list[Tag] = []
    seen_ids = set()
    for selector in CARD_SELECTORS:
        for node in soup.select(selector):
            if id(node) not in seen_ids:
                seen_ids.add(id(node))
                nodes.append(node)
    for node in nodes[:maximum * 10]:
        anchor = node.select_one("a[href]")
        if not anchor:
            continue
        link = abs_url(anchor.get("href"), page)
        if not link or not same_store(link, origin):
            continue
        heading = node.select_one("[itemprop='name'], h2, h3, h4, [class*='title'], [class*='name']")
        img = node.select_one("img")
        title = clean_str((heading.get("content") or heading.get_text(" ", strip=True)) if heading else "")
        title = title or clean_str(anchor.get("title") or (img.get("alt") if img else None) or anchor.get_text(" ", strip=True))
        if len(title) < 3:
            continue
        price, currency = extract_card_price(node, hint)
        results.append(Product(title=title, url=link, price=price, currency=currency,
                               image=find_image(node, page), method="html-card", source_page=page,
                               price_status="candidate" if price and currency else "unresolved",
                               issues=[] if price and currency else ["PRICE_MISSING_OR_CURRENCY_UNKNOWN"]))
        if len(results) >= maximum * 3:
            break
    # Fallback for listing templates with product links but no standard card wrappers.
    if not results:
        for a in soup.select("a[href]"):
            link = abs_url(a.get("href"), page)
            if not link or not same_store(link, origin) or not any(p in urlsplit(link).path.lower() for p in PRODUCT_PATHS):
                continue
            title = clean_str(a.get("title") or a.get_text(" ", strip=True))
            if len(title) < 7 or len(title) > 240:
                continue
            results.append(Product(title=title, url=link, method="product-link",
                                   source_page=page, price_status="unresolved",
                                   issues=["PDP_ENRICHMENT_REQUIRED"]))
            if len(results) >= maximum * 3:
                break
    return results


def parse_microdata(html: str, page: str) -> list[Product]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for el in soup.select("[itemscope][itemtype*='schema.org/Product']"):
        name_el = el.select_one("[itemprop='name']")
        name = clean_str(name_el.get("content") or name_el.get_text(" ", strip=True)) if name_el else ""
        if not name:
            continue
        price_el = el.select_one("[itemprop='price']")
        curr_el = el.select_one("[itemprop='priceCurrency']")
        image_el = el.select_one("[itemprop='image']")
        sku_el = el.select_one("[itemprop='sku']")
        currency = normalized_currency(curr_el.get("content") or curr_el.get_text()) if curr_el else None
        price = number_price(price_el.get("content") or price_el.get_text()) if price_el else None
        results.append(Product(title=name, url=page, price=price if currency else None, currency=currency,
                               image=abs_url(image_el.get("content") or image_el.get("src"), page) if image_el else None,
                               sku=clean_str(sku_el.get("content") or sku_el.get_text()) if sku_el else None,
                               method="microdata", source_page=page,
                               price_status="candidate" if price and currency else "unresolved"))
    return results


def parse_meta_product(html: str, page: str) -> list[Product]:
    soup = BeautifulSoup(html, "html.parser")
    def meta(prop):
        el = soup.select_one(f'meta[property="{prop}"], meta[name="{prop}"]')
        return el.get("content") if el else None
    title = meta("og:title")
    price = meta("product:price:amount") or meta("og:price:amount")
    currency = normalized_currency(meta("product:price:currency") or meta("og:price:currency"))
    if not title or not price:
        return []
    amount = number_price(price)
    return [Product(title=clean_str(title), url=page, price=amount if currency else None,
                    currency=currency, image=abs_url(meta("og:image"), page),
                    method="open-graph", source_page=page,
                    price_status="candidate" if amount and currency else "unresolved")]


def pdp_identity_matches(base: Product, candidate: Product) -> bool:
    """Never borrow pricing from a recommended/related product on the PDP."""
    if base.sku and candidate.sku and base.sku != candidate.sku:
        return False
    if normalize_product_url(base.url) != normalize_product_url(candidate.url):
        # A shared SKU can match an equivalent canonical URL only if both
        # sources explicitly publish it.
        if not (base.sku and candidate.sku and base.sku == candidate.sku):
            return False
    left = set(re.findall(r"[\w]+", base.title.casefold(), re.UNICODE))
    right = set(re.findall(r"[\w]+", candidate.title.casefold(), re.UNICODE))
    if not left or not right:
        return False
    digits_left = set(re.findall(r"\d+", base.title))
    digits_right = set(re.findall(r"\d+", candidate.title))
    if digits_left != digits_right:
        return False
    # Require high token agreement to avoid accidental color/model borrowing.
    overlap = len(left & right) / max(1, min(len(left), len(right)))
    if overlap < 0.75:
        return False
    colors = {"black", "white", "blue", "red", "green", "pink", "purple", "silver", "gold", "gray", "grey",
              "اسود", "أسود", "ابيض", "أبيض", "احمر", "أحمر", "ازرق", "أزرق", "اخضر", "أخضر", "وردي"}
    if (left & colors) and (right & colors) and (left & colors) != (right & colors):
        return False
    return True


def has_challenge(html: str) -> bool:
    segment = re.sub(r"<[^>]*>", " ", html[:100000]).lower()
    return any(x in segment for x in BLOCK_PHRASES) and len(segment) < 15000


class Scraper:
    def __init__(self, store: str, query: str, maximum: int, pages: int, browser: str, pdp: str = "all", search_url: str | None = None):
        parts = urlsplit(store)
        self.origin = f"{parts.scheme}://{parts.netloc}"
        self.prefix = parts.path.rstrip("/")
        self.store_url = self.origin + self.prefix
        self.pdp = pdp
        self.search_url = search_url
        self.query = query.strip()
        self.maximum = maximum
        self.pages = pages
        self.browser = browser
        self.diagnostics: list[Diagnostic] = []
        self._robots: RobotFileParser | None = None
        self._robots_blocked = False
        self._browser_used = False
        self._client = httpx.AsyncClient(
            follow_redirects=False, trust_env=False, timeout=httpx.Timeout(15.0, connect=8.0),
            limits=httpx.Limits(max_connections=4),
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"})

    async def close(self):
        await self._client.aclose()

    def log(self, method, url, status, found=0, detail=None, ms=0):
        self.diagnostics.append(Diagnostic(method, url, status, found, detail, int(ms)))

    async def _raw_get(self, url: str, params: dict | None = None) -> httpx.Response:
        for _ in range(4):
            ensure_public_url(url, self.origin)
            if self._robots is not None and not self._robots.can_fetch(
                    USER_AGENT, str(httpx.URL(url, params=params)) if params else url):
                raise ValueError("ROBOTS_DENIED_REDIRECT")
            response = await self._client.get(url, params=params)
            if response.status_code in (301, 302, 303, 307, 308):
                dest = response.headers.get("location")
                if not dest:
                    return response
                url = urljoin(str(response.url), dest)
                if self._robots is not None and not self._robots.can_fetch(USER_AGENT, url):
                    raise ValueError("ROBOTS_DENIED_ON_REDIRECT")
                params = None
                continue
            return response
        raise ValueError("TOO_MANY_REDIRECTS")

    async def prepare(self):
        ensure_public_url(self.origin)
        url = self.origin + "/robots.txt"
        try:
            response = await self._raw_get(url)
            if response.status_code == 404:
                self._robots = RobotFileParser()
                self._robots.parse([])
                self.log("robots", url, "missing_allow")
            elif response.status_code == 200:
                self._robots = RobotFileParser()
                self._robots.parse(response.text.splitlines())
                self.log("robots", url, "parsed")
            else:
                self._robots_blocked = True
                self.log("robots", url, "unavailable", detail=f"HTTP_{response.status_code}")
        except Exception as exc:
            self._robots_blocked = True
            self.log("robots", url, "unavailable", detail=type(exc).__name__ + ": " + str(exc)[:120])

    def permitted(self, url: str) -> bool:
        if self._robots_blocked or self._robots is None:
            return False
        try:
            ensure_public_url(url, self.origin)
            return self._robots.can_fetch(USER_AGENT, url)
        except Exception:
            return False

    async def fetch(self, method: str, url: str, params: dict | None = None) -> str | None:
        requested = str(httpx.URL(url, params=params)) if params else url
        if not self.permitted(requested):
            self.log(method, requested, "ROBOTS_DENIED_OR_UNSAFE")
            return None
        started = time.monotonic()
        try:
            response = await self._raw_get(url, params)
            elapsed = (time.monotonic() - started) * 1000
            if response.status_code in (403, 429):
                self.log(method, requested, "BLOCKED_OR_RATE_LIMITED", detail=str(response.status_code), ms=elapsed)
                return None
            if response.status_code >= 400:
                self.log(method, requested, "HTTP_ERROR", detail=str(response.status_code), ms=elapsed)
                return None
            if len(response.content) > 3_000_000:
                self.log(method, requested, "RESPONSE_TOO_LARGE", ms=elapsed)
                return None
            body = response.text
            if has_challenge(body):
                self.log(method, requested, "CHALLENGE_PAGE", ms=elapsed)
                return None
            self.log(method, requested, "OK", ms=elapsed)
            return body
        except Exception as exc:
            self.log(method, requested, "FETCH_ERROR", detail=type(exc).__name__ + ": " + str(exc)[:130],
                     ms=(time.monotonic() - started) * 1000)
            return None

    async def browser_fetch(self, url: str) -> str | None:
        if self.browser == "never" or self._browser_used or not self.permitted(url):
            return None
        self._browser_used = True
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            self.log("browser", url, "PLAYWRIGHT_NOT_INSTALLED")
            return None
        started = time.monotonic()
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(user_agent=USER_AGENT)
                page = await context.new_page()
                response = await page.goto(url, wait_until="domcontentloaded", timeout=20000)
                if response and response.status >= 400:
                    classification = "BLOCKED_OR_RATE_LIMITED" if response.status in (403, 429) else "HTTP_ERROR"
                    self.log("browser", url, classification, detail=str(response.status))
                    await browser.close()
                    return None
                await page.wait_for_timeout(1200)
                html = await page.content()
                await browser.close()
            if has_challenge(html):
                self.log("browser", url, "CHALLENGE_PAGE")
                return None
            self.log("browser", url, "OK", ms=(time.monotonic() - started) * 1000)
            return html
        except Exception as exc:
            self.log("browser", url, "BROWSER_ERROR", detail=type(exc).__name__ + ": " + str(exc)[:160])
            return None

    def map_shopify(self, payload: dict, base: str) -> list[Product]:
        records = payload.get("resources", {}).get("results", {}).get("products", [])
        output = []
        for item in records:
            if not isinstance(item, dict):
                continue
            name = clean_str(item.get("title"))
            url = abs_url(item.get("url"), base)
            if not name or not url:
                continue
            hint = normalized_currency(item.get("currency") or item.get("currency_code"))
            raw = item.get("price")
            pmax = item.get("price_max")
            value = number_price(raw)
            currency = currency_from_text(str(raw), hint)
            issues = []
            if pmax is not None and number_price(pmax) != value:
                issues.append("VARIANT_PRICE_RANGE")
                value = None
            if not currency:
                issues.append("CURRENCY_UNVERIFIED")
                value = None
            output.append(Product(title=name, url=url, price=value, currency=currency,
                                  image=abs_url(item.get("featured_image", {}).get("url") if isinstance(item.get("featured_image"), dict) else (item.get("featured_image") or item.get("image")), base),
                                  method="shopify-predictive", source_page=base,
                                  price_status="candidate" if value else "unresolved", issues=issues))
        return output

    def map_woo(self, payload: list[dict], base: str) -> list[Product]:
        output = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            title = clean_str(item.get("name"))
            url = abs_url(item.get("permalink"), base)
            if not title or not url:
                continue
            prices = item.get("prices") or {}
            currency = normalized_currency(prices.get("currency_code"))
            minor = prices.get("currency_minor_unit")
            raw = prices.get("price")
            value = None
            if isinstance(minor, int) and 0 <= minor <= 4 and raw is not None and currency:
                try:
                    dec = Decimal(str(raw)) / (Decimal(10) ** minor)
                    if dec.is_finite() and dec > 0:
                        value = str(dec)
                except (InvalidOperation, ValueError):
                    pass
            issues = []
            if item.get("type") == "variable":
                value = None
                issues.append("VARIANT_PRICE_RANGE")
            if not value:
                issues.append("PRICE_MISSING_OR_AMBIGUOUS")
            images = item.get("images") or []
            image = abs_url(images[0].get("src"), base) if images and isinstance(images[0], dict) else None
            output.append(Product(title=title, url=url, price=value, currency=currency, image=image,
                                  sku=clean_str(item.get("sku")) or None,
                                  method="woocommerce-store-api", source_page=base,
                                  price_status="candidate" if value else "unresolved", issues=issues))
        return output

    def search_targets(self, homepage: str) -> list[tuple[str, dict[str, str]]]:
        """Learn GET search URLs from storefront forms before guessing routes."""
        targets: list[tuple[str, dict[str, str]]] = []
        if self.search_url:
            url = self.search_url.replace("{query}", quote(self.query, safe=""))
            if same_store(url, self.origin) and urlsplit(url).scheme == "https":
                targets.append((url, {}))
            else:
                self.log("discovery", url, "UNSAFE_SEARCH_URL")
        if homepage:
            soup = BeautifulSoup(homepage, "html.parser")
            for form in soup.find_all("form", limit=30):
                if (form.get("method") or "get").lower() != "get":
                    continue
                field = form.select_one(
                    'input[name="q"], input[name="s"], input[name="query"], '
                    'input[name="search"], input[name="keyword"], input[name="search_term"], '
                    'input[type="search"][name]'
                )
                if not field or not field.get("name"):
                    continue
                action = urljoin(self.store_url + "/", form.get("action") or "/")
                if not same_store(action, self.origin) or urlsplit(action).scheme != "https":
                    continue
                params = {field["name"]: self.query}
                for hidden in form.select('input[type="hidden"][name]')[:8]:
                    value = hidden.get("value", "")
                    if len(value) <= 128:
                        params[hidden["name"]] = value
                targets.append((action, params))
        targets.extend([
            (self.origin + self.prefix + "/search/", {"q": self.query}),
            (self.origin + self.prefix + "/", {"s": self.query, "post_type": "product"}),
            (self.origin + self.prefix + "/catalogsearch/result/", {"q": self.query}),
        ])
        unique = {}
        for url, params in targets:
            key = str(httpx.URL(url, params=params)) if params else url
            unique.setdefault(key, (url, params))
        return list(unique.values())[:5]

    async def search(self) -> dict:
        await self.prepare()
        if self._robots_blocked:
            return self.result([], "robots_unavailable")
        homepage = await self.fetch("homepage", self.store_url + "/")
        home_lower = (homepage or "").lower()
        products: list[Product] = []
        if "shopify" in home_lower:
            url = self.store_url + "/search/suggest.json"
            body = await self.fetch("shopify", url, {"q": self.query, "resources[type]": "product", "resources[limit]": "10"})
            if body:
                try:
                    products.extend(self.map_shopify(json.loads(body), self.origin))
                except (ValueError, TypeError, AttributeError) as exc:
                    self.log("shopify-parse", url, "INVALID_JSON_OR_SCHEMA", detail=str(exc)[:130])
        if "woocommerce" in home_lower or "wc-block" in home_lower or "wp-content/plugins/woocommerce" in home_lower:
            url = self.origin + "/wp-json/wc/store/v1/products"
            body = await self.fetch("woocommerce", url, {"search": self.query, "per_page": str(min(self.maximum, 100))})
            if body:
                try:
                    payload = json.loads(body)
                    if isinstance(payload, list):
                        products.extend(self.map_woo(payload, self.origin))
                except (ValueError, TypeError, AttributeError) as exc:
                    self.log("woo-parse", url, "INVALID_JSON_OR_SCHEMA", detail=str(exc)[:130])
        # This is bounded discovery, not a claim that every site's search path is identical.
        search_paths = self.search_targets(homepage or "")
        # Avoid making several redundant searches if the public platform API suffices.
        if len(products) < self.maximum:
            for page_url, params in search_paths:
                if len(products) >= self.maximum * 2:
                    break
                for page_num in range(1, self.pages + 1):
                    current = dict(params)
                    if page_num > 1:
                        current["page"] = str(page_num)
                    body = await self.fetch("search-html", page_url, current)
                    if not body:
                        continue
                    absolute_page = str(httpx.URL(page_url, params=current))
                    parsed = parse_jsonld(body, absolute_page) + parse_html_cards(body, absolute_page, self.origin, self.maximum)
                    self.log("search-extract", absolute_page, "PARSED", len(parsed))
                    products.extend(parsed)
                    if not parsed and page_num == 1 and self.browser in {"auto", "always"}:
                        # A JS-rendered search may produce a blank static HTML shell.
                        rendered = await self.browser_fetch(absolute_page)
                        if rendered:
                            found = parse_jsonld(rendered, absolute_page) + parse_html_cards(rendered, absolute_page, self.origin, self.maximum)
                            products.extend(found)
                            self.log("render-extract", absolute_page, "PARSED", len(found))
        products = self.merge(products)
        # PDP enrichment only for discovered links; respect page budgets.
        unresolved = (products if self.pdp == "all" else
                      [p for p in products if not p.price or not p.image] if self.pdp == "missing" else [])
        sem = asyncio.Semaphore(3)

        async def enrich(product: Product):
            if not same_store(product.url, self.origin):
                product.issues.append("FOREIGN_PRODUCT_URL")
                return
            async with sem:
                body = await self.fetch("product-detail", product.url)
                if not body:
                    return
                candidates = parse_jsonld(body, product.url) + parse_microdata(body, product.url) + parse_meta_product(body, product.url)
                # Evidence from a PDP is associated only if SKU or URL aligns.
                matches = [p for p in candidates if pdp_identity_matches(product, p)]
                if not matches:
                    return
                prices = {(p.price, p.currency) for p in matches if p.price and p.currency}
                if len(prices) > 1:
                    product.price = None
                    product.price_status = "conflict"
                    product.issues.append("PDP_PRICE_CONFLICT")
                elif len(prices) == 1:
                    price, currency = next(iter(prices))
                    if product.price and product.currency and (price, currency) != (product.price, product.currency):
                        product.price = None
                        product.price_status = "conflict"
                        product.issues.append("LISTING_PDP_PRICE_CONFLICT")
                    else:
                        product.price, product.currency = price, currency
                        product.price_status = "evidence_correlated"
                if not product.image:
                    product.image = next((p.image for p in matches if p.image), None)
                if not product.sku:
                    product.sku = next((p.sku for p in matches if p.sku), None)
        await asyncio.gather(*(enrich(p) for p in unresolved[:self.maximum]))
        products = self.merge(products)
        for p in products:
            if p.price_status == "candidate":
                p.price_status = "single_source_unverified"
            if p.price and p.currency and p.price_status not in ("conflict", "evidence_correlated"):
                p.price_status = "single_source_unverified"
            if not p.price or not p.currency:
                p.price_status = "conflict" if p.price_status == "conflict" else "unresolved"
            p.issues = sorted(set(p.issues))
            p.observed_at_utc = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        products = products[:self.maximum]
        outcome = "ok" if any(x.price for x in products) else "partial_or_unavailable"
        return self.result(products, outcome)

    def merge(self, products: list[Product]) -> list[Product]:
        merged: dict[tuple, Product] = {}
        for p in products:
            if not p.title or not p.url or not same_store(p.url, self.origin):
                continue
            key = (normalize_product_url(p.url), p.sku or "")
            if key not in merged:
                merged[key] = p
                continue
            old = merged[key]
            if not old.image:
                old.image = p.image
            if not old.sku:
                old.sku = p.sku
            if not old.price and p.price and old.price_status != "conflict":
                old.price, old.currency = p.price, p.currency
                old.price_status = p.price_status
                old.method += "+" + p.method
            elif old.price and p.price and (old.price, old.currency) != (p.price, p.currency):
                old.price = None
                old.price_status = "conflict"
                old.issues.append("SOURCE_PRICE_DISAGREEMENT")
            old.issues.extend(p.issues)
        return list(merged.values())

    def result(self, products: list[Product], status: str):
        return {"store": self.store_url, "query": self.query, "status": status,
                "count": len(products), "products": [asdict(p) for p in products],
                "diagnostics": [asdict(d) for d in self.diagnostics]}


def main():
    parser = argparse.ArgumentParser(description="Public ecommerce product discovery and verified-evidence scraper")
    parser.add_argument("--store", required=True, help="HTTPS storefront URL")
    parser.add_argument("--query", required=True, help="Search query in any language")
    parser.add_argument("--max", type=int, default=20, dest="maximum", help="Maximum returned products (1..100)")
    parser.add_argument("--pages", type=int, default=1, help="HTML search pages per template (1..3)")
    parser.add_argument("--browser", choices=["never", "auto", "always"], default="auto")
    parser.add_argument("--search-url", help='Explicit HTTPS search template, e.g. https://store/search?q={query}')
    parser.add_argument("--pdp", choices=["all", "missing", "none"], default="all",
                        help="PDP verification: all products (default), only missing fields, or none")
    parser.add_argument("--out", default="-", help="Output JSON path, or - for stdout")
    args = parser.parse_args()
    if not 1 <= args.maximum <= 100 or not 1 <= args.pages <= 3 or not args.query.strip():
        parser.error("--max must be 1..100; --pages 1..3; --query nonempty")
    async def runner():
        scraper = Scraper(args.store, args.query, args.maximum, args.pages, args.browser, args.pdp, args.search_url)
        try:
            return await scraper.search()
        finally:
            await scraper.close()
    try:
        result = asyncio.run(runner())
    except Exception as exc:
        result = {"store": args.store, "query": args.query, "status": "fatal_error", "count": 0,
                  "products": [], "diagnostics": [{"status": type(exc).__name__, "detail": str(exc)[:300]}]}
    body = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out == "-":
        print(body)
    else:
        with open(args.out, "w", encoding="utf-8") as output:
            output.write(body + "\n")
        print(f"Saved {result['count']} products to {args.out}", file=sys.stderr)
    return 0 if result["status"] in {"ok", "partial_or_unavailable"} else 2


if __name__ == "__main__":
    sys.exit(main())