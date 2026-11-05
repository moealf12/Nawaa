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

# In-process robots cache reduces redundant public-source requests. Only a
# successfully fetched robots policy or true 404 is cached; access failures
# NEVER become an implicit allow. Policy is refreshed after two minutes.
_ROBOTS_CACHE: dict[str, tuple[float, RobotFileParser]] = {}
_ROBOTS_TTL_SECONDS = 120.0


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
    # Evidence-based intent annotations, never used to falsify/mask raw offers.
    intent_match: str = "unclassified"
    intent_reasons: list[str] = field(default_factory=list)
    condition: str = "unknown"
    price_evidence: str = "unavailable"
    price_source: str = "unavailable"


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
    """ASIN-scoped Amazon US PLP parser; never borrow a sibling card's price.

    In addition to standard data-asin cards, supports a tightly scoped fallback
    around a product-title link when Amazon omits data-component-type. Every
    fallback container must have exactly one linked ASIN and one product heading.
    """
    soup = BeautifulSoup(html, "html.parser")
    asin_in_href = re.compile(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?#]|$)", re.I)

    def asin_for_link(anchor: Tag) -> str | None:
        match = asin_in_href.search(anchor.get("href", ""))
        return match.group(1).upper() if match else None

    cards: list[tuple[Tag, str]] = []
    for card in soup.select("[data-component-type='s-search-result'][data-asin], div.s-result-item[data-asin]"):
        asin = clean_str(card.get("data-asin")).upper()
        if re.fullmatch(r"[A-Z0-9]{10}", asin):
            cards.append((card, asin))

    if not cards:
        for anchor in soup.select("a[href*='/dp/'], a[href*='/gp/product/']"):
            asin = asin_for_link(anchor)
            if not asin or not (anchor.find("h2") or anchor.find_parent("h2")):
                continue
            for ancestor in list(anchor.parents)[:7]:
                if not isinstance(ancestor, Tag) or ancestor.name in ("body", "html"):
                    break
                # A weak ancestor that includes more than one product is unsafe.
                asin_ids = {v for a in ancestor.select("a[href]")
                            if (v := asin_for_link(a))}
                headings = ancestor.select("h2")
                if asin_ids == {asin} and len(headings) == 1 and (ancestor.select_one("img.s-image") or ancestor.select_one("span.a-price")):
                    cards.append((ancestor, asin))
                    break

    products: list[Product] = []
    seen: set[str] = set()
    for card, asin in cards:
        if asin in seen:
            continue
        title_anchor = next((a for a in card.select("a[href]")
                            if asin_for_link(a) == asin and (a.find("h2") or a.find_parent("h2"))), None)
        if title_anchor is None:
            continue
        title_tag = title_anchor.find("h2") or title_anchor.find_parent("h2")
        title = clean_str(title_tag.get_text(" ", strip=True) if title_tag else "")
        if len(title) < 7:
            continue
        # A crossed-out reference price and a per-unit secondary price are not
        # the same as the current purchase price.
        raw_prices = [e.get_text(" ", strip=True) for e in
                      card.select("span.a-price:not(.a-text-price) span.a-offscreen")]
        prices = {price for raw in raw_prices
                  if (raw.startswith("$") or re.search(r"\bUSD\b", raw, re.I))
                  if (price := number_price(raw)) is not None}
        price = next(iter(prices)) if len(prices) == 1 else None
        currency = "USD" if price else None
        issues: list[str] = []
        if len(prices) > 1:
            issues.append("AMAZON_MULTIPLE_CURRENT_PRICES")
        elif not price:
            issues.append("AMAZON_CURRENT_PRICE_MISSING")
        elif not any(re.search(r"\bUSD\b", raw, re.I) for raw in raw_prices):
            issues.append("USD_INFERRED_FROM_AMAZON_US_CONTEXT")

        image = None
        for img in card.select("img.s-image"):
            # A product image must be an actual Amazon media product asset.
            for attr in ("data-src", "data-lazy-src", "src"):
                candidate = abs_url(img.get(attr), page)
                if candidate and host(candidate) in {"m.media-amazon.com", "images-na.ssl-images-amazon.com"} and "/images/I/" in urlsplit(candidate).path:
                    image = candidate
                    break
            if image:
                break
        if not image:
            issues.append("AMAZON_PRODUCT_IMAGE_MISSING")
        seen.add(asin)
        products.append(Product(title=title, url=f"https://www.amazon.com/dp/{asin}",
                                sku=asin, price=price, currency=currency, image=image,
                                method="amazon-us-html-card", source_page=page,
                                price_status="candidate" if price and image else "unresolved",
                                issues=issues))
        if len(products) >= maximum:
            break
    if not products and not soup.select_one("[data-component-type='s-search-result'][data-asin], div.s-result-item[data-asin]"):
        # Evidence-poor Amazon layout: keep only a title-linked ASIN. Never
        # attach prices/images from a neighboring element or generic fallback.
        for anchor in soup.select("a[href*='/dp/'], a[href*='/gp/product/']"):
            asin = asin_for_link(anchor)
            if not asin or asin in seen:
                continue
            heading = anchor.find("h2") or anchor.find_parent("h2")
            title = clean_str(heading.get_text(" ", strip=True) if heading else "")
            if len(title) < 7:
                continue
            seen.add(asin)
            products.append(Product(title=title, url=f"https://www.amazon.com/dp/{asin}",
                                    sku=asin, method="amazon-us-title-link",
                                    source_page=page, price_status="unresolved",
                                    issues=["AMAZON_CARD_EVIDENCE_MISSING"]))
            if len(products) >= maximum:
                break
    return products


def parse_amazon_us_pdp(html: str, page: str) -> list[Product]:
    """Conservative Amazon US PDP extraction tied to the page's selected ASIN.

    Never scan all page prices: recommendations, subscriptions, crossed-out
    totals, and alternate variations often coexist with the buy-box price.
    """
    if host(page) not in {"amazon.com", "www.amazon.com"}:
        return []
    match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?#]|$)", urlsplit(page).path, re.I)
    if not match:
        return []
    asin = match.group(1).upper()
    soup = BeautifulSoup(html, "html.parser")
    selected = soup.select_one("input#ASIN[value], input[name='ASIN'][value]")
    selected_asin = clean_str(selected.get("value")).upper() if selected else None
    canonical = soup.select_one("link[rel='canonical'][href]")
    canonical_match = (re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})(?:[/?#]|$)",
                                 canonical.get("href", ""), re.I)
                       if canonical else None)
    canonical_asin = canonical_match.group(1).upper() if canonical_match else None
    # The selected ASIN is authoritative; missing identity proof is not parity.
    if (selected_asin and selected_asin != asin) or (canonical_asin and canonical_asin != asin):
        return []
    if not (selected_asin == asin or canonical_asin == asin):
        return []
    title_tag = soup.select_one("#productTitle")
    title = clean_str(title_tag.get_text(" ", strip=True) if title_tag else "")
    if len(title) < 7:
        return []

    price = None
    price_problem = "AMAZON_PDP_BUYBOX_PRICE_NOT_FOUND"
    price_region = None
    # Multiple Amazon display modules may coexist. An empty first module is
    # NOT evidence the other primary modules lack a usable current price.
    # Disagreeing primary modules are *conflicts*, never a chosen cheapest price.
    selectors = (
        ("corePrice_feature", "#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen"),
        ("corePriceDisplay_desktop", "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen"),
        ("apex_desktop", "#apex_desktop .a-price:not(.a-text-price) .a-offscreen"),
        ("buybox_deal", "#priceblock_dealprice"),
        ("buybox_our", "#priceblock_ourprice"),
        ("buybox_inside", "#price_inside_buybox"),
    )
    primary_values: set[str] = set()
    regions_seen: list[str] = []
    ambiguous_region = False
    for name, selector in selectors:
        nodes = soup.select(selector)
        if not nodes:
            continue
        prices = {value for el in nodes if (raw := el.get_text(" ", strip=True))
                  if (raw.startswith("$") or re.search(r"\bUSD\b", raw, re.I))
                  if (value := number_price(raw)) is not None}
        if len(prices) > 1:
            ambiguous_region = True
            regions_seen.append(name)
            break
        if prices:
            primary_values.update(prices)
            regions_seen.append(name)
    if ambiguous_region or len(primary_values) > 1:
        price_problem = "AMAZON_PDP_MULTIPLE_BUYBOX_PRICES"
    elif len(primary_values) == 1:
        price = next(iter(primary_values))
        price_problem = ""
        price_region = regions_seen[0]
    elif soup.select("span.a-price:not(.a-text-price) span.a-offscreen"):
        price_problem = "AMAZON_PDP_PRIMARY_PRICE_NOT_EVIDENCED"

    image = None
    for element in soup.select("img#landingImage, #imgTagWrapperId img, meta[property='og:image']"):
        for attr in ("data-old-hires", "data-src", "src", "content"):
            candidate = abs_url(element.get(attr), page)
            if (candidate and host(candidate) in {"m.media-amazon.com", "images-na.ssl-images-amazon.com"}
                    and "/images/I/" in urlsplit(candidate).path):
                image = candidate
                break
        if image:
            break
    issues = [price_problem] if price_problem else ["USD_INFERRED_FROM_AMAZON_US_CONTEXT"]
    issues.append("AMAZON_PDP_ASIN_PROOF")
    if price_region:
        issues.append("AMAZON_PDP_PRIMARY_PRICE_SOURCE_" + price_region.upper())
    if not image:
        issues.append("AMAZON_PDP_PRODUCT_IMAGE_NOT_FOUND")
    return [Product(title=title, url=f"https://www.amazon.com/dp/{asin}", sku=asin,
                    price=price, currency="USD" if price else None, image=image,
                    method="amazon-us-pdp-main-buybox", source_page=page,
                    price_status="candidate" if price else "unresolved", issues=issues)]


def parse_html_cards(html: str, page: str, origin: str, maximum: int) -> list[Product]:
    if host(origin) == "www.amazon.com" or host(origin) == "amazon.com":
        amazon_cards = parse_amazon_us_cards(html, page, maximum)
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


def _critical_variant_specs(title: str) -> tuple[frozenset[str], frozenset[str]]:
    """Only explicit SKU-distinguishing storage/variant specs, not marketing numbers."""
    t = clean_str(title).casefold()
    storage = frozenset(re.sub(r"\s+", "", amount) for amount in
                        re.findall(r"\b\d+(?:\.\d+)?\s*(?:gb|tb)\b", t))
    family = ("iphone" if re.search(r"\biphone\s*\d+\b", t) else
              "galaxy" if re.search(r"\bgalaxy\s*s\d+\b", t) else
              "ps5" if re.search(r"\b(?:ps5|playstation\s*5)\b", t) else "")
    variants = frozenset(re.findall(
        r"\b(?:ultra|pro|max|plus|mini|fe|digital\s+edition|disc\s+edition)\b", t
    )) if family else frozenset()
    return storage, variants


def pdp_identity_matches(base: Product, candidate: Product) -> bool:
    """Price can transfer only between the same verifiable item and variant.

    For Amazon's *ASIN-proved main-buybox PDP only*, exact selected/canonical
    ASIN is stronger than noisy title tokens (marketing numerals/dates vary).
    Variant-relevant storage, color, and family edition conflicts still veto.
    All other candidates retain conservative title-token agreement.
    """
    if base.sku and candidate.sku and base.sku.upper() != candidate.sku.upper():
        return False
    if normalize_product_url(base.url) != normalize_product_url(candidate.url):
        if not (base.sku and candidate.sku and base.sku.upper() == candidate.sku.upper()):
            return False
    left = set(re.findall(r"[\w]+", base.title.casefold(), re.UNICODE))
    right = set(re.findall(r"[\w]+", candidate.title.casefold(), re.UNICODE))
    if not left or not right:
        return False
    colors = {"black", "white", "blue", "red", "green", "pink", "purple", "silver", "gold",
              "gray", "grey", "اسود", "أسود", "ابيض", "أبيض", "احمر", "أحمر", "ازرق", "أزرق", "اخضر", "أخضر", "وردي"}
    if (left & colors) and (right & colors) and (left & colors) != (right & colors):
        return False
    proved_amazon = (
        candidate.method == "amazon-us-pdp-main-buybox"
        and base.sku and candidate.sku and base.sku.upper() == candidate.sku.upper()
        and host(candidate.url) in {"amazon.com", "www.amazon.com"}
        and "AMAZON_PDP_ASIN_PROOF" in candidate.issues
    )
    if proved_amazon:
        base_storage, base_editions = _critical_variant_specs(base.title)
        pdp_storage, pdp_editions = _critical_variant_specs(candidate.title)
        if base_storage and pdp_storage and base_storage != pdp_storage:
            return False
        if base_editions != pdp_editions:
            return False
        return True
    # Existing strict fallback for all other stores and weaker PDP evidence.
    if set(re.findall(r"\d+", base.title)) != set(re.findall(r"\d+", candidate.title)):
        return False
    return len(left & right) / max(1, min(len(left), len(right))) >= 0.75


def has_challenge(html: str) -> bool:
    segment = re.sub(r"<[^>]*>", " ", html[:100000]).lower()
    return any(x in segment for x in BLOCK_PHRASES) and len(segment) < 15000


def classify_product_intent(query: str, title: str) -> tuple[str, list[str], str]:
    """Conservative title-evidence classification. Does not drop a product.

    exact: requested product class/model and explicit constraints evidenced
    related: same family / alternative class / different requested variant
    mismatch: contradictory product type or explicit numeric constraint
    unclassified: title is insufficient; never guess an exact match
    The parser is intentionally narrow for high-risk confusion cases.
    """
    q = re.sub(r"[\s\u00ae]+", " ", clean_str(query).casefold()).strip()
    t = re.sub(r"[\s\u00ae]+", " ", clean_str(title).casefold()).strip()
    condition = ("renewed_premium" if re.search(r"\brenewed premium\b", t) else
                 "renewed" if re.search(r"\b(renewed|refurbished|recertified)\b", t) else
                 "used" if re.search(r"\b(pre-owned|used|open box)\b", t) else
                 "new_claimed" if re.search(r"\bbrand new\b", t) else "unspecified")

    def found(pattern: str, target: str = t) -> bool:
        return bool(re.search(pattern, target, re.I))

    ps5 = r"(?:\bps5\b|\bplaystation\s*5\b)"
    if found(ps5, q):
        is_disc_request = found(r"\b(?:disc|disk|blu[\s-]?ray)\b.*\bdrive\b|\bdrive\b.*\b(?:disc|disk)\b", q)
        if is_disc_request:
            if found(r"\b(?:ssd|nvme|solid state|hard drive|storage|game drive)\b") and not found(r"\b(?:disc|disk|blu[\s-]?ray)\s+drive\b"):
                return "mismatch", ["SSD_STORAGE_NOT_DISC_DRIVE"], condition
            has_disc_identity = found(r"\b(?:disc|disk|blu[\s-]?ray)\b.*\bdrive\b|\bdrive\b.*\b(?:disc|disk)\b")
            if found(ps5) and has_disc_identity:
                # A KEM optical replacement module, repair kit or connector is
                # an alternative part, not the complete PS5 disc-drive add-on.
                if found(r"\b(?:replacement|repair|connector|module|laser|kem[\s-]?\d+|optical|spare part)\b"):
                    return "related", ["PS5_DISC_DRIVE_REPAIR_PART_NOT_COMPLETE_ADDON"], condition
                return "exact", ["PS5_DISC_DRIVE_CLASS"], condition
            if found(ps5):
                return "related", ["PS5_FAMILY_NOT_PROVEN_DISC_DRIVE"], condition
            return "mismatch", ["WRONG_PS5_DISC_DRIVE_FAMILY"], condition
        is_console_request = found(r"\b(?:console|digital edition|slim console|pro console)\b", q)
        if is_console_request:
            if not found(ps5):
                return "mismatch", ["WRONG_CONSOLE_FAMILY"], condition
            if found(r"\b(?:portal|remote player)\b"):
                return "mismatch", ["ACCESSORY_NOT_PS5_CONSOLE"], condition
            if found(r"\b(?:video\s*game|videogame|physical disc|game disc|standard edition|game code|disc only|game only|download code)\b"):
                return "mismatch", ["GAME_NOT_PS5_CONSOLE"], condition
            if found(r"\b(?:cover|skin|case|faceplate|stand|dock|charging station|replacement|repair|disc drive|disk drive|optical drive)\b"):
                return "mismatch", ["ACCESSORY_NOT_PS5_CONSOLE"], condition
            # "Controller for PS5 console" is not a console. But a console
            # bundle "with two controllers" legitimately remains a console.
            if found(r"\b(?:controller|dualsense|gamepad)\b") and not found(r"\bconsole\b"):
                return "mismatch", ["CONTROLLER_NOT_PS5_CONSOLE"], condition
            if found(r"\b(?:controller|dualsense|gamepad)\b") and found(
                    r"\b(?:controller|dualsense|gamepad)\b.{0,26}\b(?:for|compatible)\b"):
                return "mismatch", ["CONTROLLER_NOT_PS5_CONSOLE"], condition
            if found(r"\b(?:console|digital edition)\b"):
                return "exact", ["PS5_CONSOLE_CLASS"], condition
            return "unclassified", ["PS5_CONSOLE_IDENTITY_NOT_PROVEN"], condition

    # Model-family matches must not silently conflate base/Plus/Ultra/Pro/Max.
    for family,rx,variants in [
        ("IPHONE_17", r"\biphone\s*17\b", r"\b(?:pro|max|plus|air)\b"),
        ("GALAXY_S25", r"\b(?:samsung\s+)?galaxy\s*s25\b", r"\b(?:ultra|plus|fe)\b|(?<!\w)s25\+"),
    ]:
        if found(rx,q):
            if not found(rx):
                return "mismatch", [family+"_MISSING"], condition
            requested_special = found(variants, q)
            actual_special = found(variants, t)
            if requested_special != actual_special:
                return "related", [family+"_MODEL_VARIANT_DIFFERENT"], condition
            return "exact", [family+"_MODEL_EVIDENCED"], condition

    if found(r"\b(?:laptop|notebook|macbook|lap\s*top|لابتوب)\b",q):
        if not found(r"\b(?:laptop|notebook|macbook|lap\s*top|لابتوب)\b"):
            return "mismatch", ["NOT_A_LAPTOP"], condition
        ram_match = re.search(r"\b(\d{1,3})\s*gb\s*(?:ram|ddr\d?|unified\s+memory|memory)\b",q)
        if ram_match:
            amount = ram_match.group(1)
            if found(rf"\b{re.escape(amount)}\s*gb\s*(?:ram|ddr\d?|unified\s+memory|memory)\b"):
                return "exact", ["EXPLICIT_RAM_MATCH_"+amount+"GB"], condition
            if found(r"\b\d{1,3}\s*gb\s*(?:ram|ddr\d?|unified\s+memory|memory)\b"):
                return "mismatch", ["RAM_CAPACITY_CONFLICT"], condition
            return "unclassified", ["RAM_CAPACITY_UNPROVEN"], condition
        return "exact", ["LAPTOP_CLASS"], condition

    if found(r"\b(?:4k|uhd|3840)\b",q) and found(r"\b(?:monitor|display)\b",q):
        if not found(r"\b(?:monitor|pc display|gaming display)\b"):
            return "mismatch", ["NOT_A_MONITOR"], condition
        if not found(r"\b(?:4k|uhd|3840\s*[x×]\s*2160)\b"):
            return "unclassified", ["RESOLUTION_UNPROVEN"], condition
        return "exact", ["4K_MONITOR_CLASS"], condition

    if found(r"\b(?:robot|robotic)\b",q) and found(r"\bvacuum\b",q):
        if found(r"\b(?:robot|robotic)\b") and found(r"\b(?:vacuum|cleaner)\b"):
            return "exact", ["ROBOT_VACUUM_CLASS"], condition
        return "mismatch", ["NOT_ROBOT_VACUUM"], condition

    if found(r"\bjbl\b",q) and found(r"\b(?:speaker|speakers)\b",q):
        if not found(r"\b(?:speaker|speakers|boombox)\b"):
            return "mismatch", ["NOT_A_SPEAKER"], condition
        return "exact" if found(r"\bjbl\b") else "unclassified", ["JBL_BRAND_EVIDENCED" if found(r"\bjbl\b") else "JBL_BRAND_NOT_EVIDENCED"], condition

    if (found(r"\b(?:headphones|headsets)\b",q) and found(r"\bwireless\b",q)):
        if found(r"\b(?:earbuds|ear\s*buds|in-ear)\b") and not found(r"\bheadphones\b"):
            return "related", ["WIRELESS_EARBUDS_ALTERNATIVE"], condition
        if found(r"\b(?:headphones|headset|on-ear|over-ear)\b"):
            return "exact", ["WIRELESS_HEADPHONES_CLASS"], condition
        return "unclassified", ["WIRELESS_HEADPHONES_UNPROVEN"], condition

    if ("بلوتوث" in q and ("سماعات" in q or "سماعة" in q)):
        if found(r"\b(?:headphones|earbuds|ear\s*buds|earphones|bluetooth|headset)\b|سماعات|سماعة"):
            return "exact", ["BLUETOOTH_AUDIO_CLASS"], condition
        return "unclassified", ["BLUETOOTH_AUDIO_UNPROVEN"], condition

    return "unclassified", ["NO_EXPLICIT_INTENT_RULE"], condition


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
        # Search-scoped upper bound: at most three PDP content-negotiation
        # recovery reads, never on 403/429, challenge or missing HTTP body.
        self._amazon_pdp_retry_budget = 3
        self._client = httpx.AsyncClient(
            follow_redirects=False, trust_env=False, timeout=httpx.Timeout(15.0, connect=8.0),
            limits=httpx.Limits(max_connections=4),
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"})

    async def close(self):
        await self._client.aclose()

    def log(self, method, url, status, found=0, detail=None, ms=0):
        self.diagnostics.append(Diagnostic(method, url, status, found, detail, int(ms)))

    async def _raw_get(self, url: str, params: dict | None = None,
                       headers: dict[str, str] | None = None) -> httpx.Response:
        for _ in range(4):
            ensure_public_url(url, self.origin)
            if self._robots is not None and not self._robots.can_fetch(
                    USER_AGENT, str(httpx.URL(url, params=params)) if params else url):
                raise ValueError("ROBOTS_DENIED_REDIRECT")
            response = await self._client.get(url, params=params, headers=headers)
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
        cached = _ROBOTS_CACHE.get(self.origin)
        if cached and cached[0] > time.monotonic():
            self._robots = cached[1]
            self.log("robots", url, "cache_hit")
            return
        # Drop expired policy before making a new network request.
        _ROBOTS_CACHE.pop(self.origin, None)
        try:
            response = await self._raw_get(url)
            if response.status_code == 404:
                self._robots = RobotFileParser()
                self._robots.parse([])
                _ROBOTS_CACHE[self.origin] = (time.monotonic() + _ROBOTS_TTL_SECONDS, self._robots)
                self.log("robots", url, "missing_allow")
            elif response.status_code == 200:
                self._robots = RobotFileParser()
                self._robots.parse(response.text.splitlines())
                _ROBOTS_CACHE[self.origin] = (time.monotonic() + _ROBOTS_TTL_SECONDS, self._robots)
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

    async def fetch(self, method: str, url: str, params: dict | None = None,
                    headers: dict[str, str] | None = None) -> str | None:
        requested = str(httpx.URL(url, params=params)) if params else url
        if not self.permitted(requested):
            self.log(method, requested, "ROBOTS_DENIED_OR_UNSAFE")
            return None
        started = time.monotonic()
        try:
            response = await self._raw_get(url, params, headers=headers)
            # Content negotiation only: transparent, unchanged NAWAA User-Agent
            # and exact same HTTPS origin. This is NOT a block/CAPTCHA bypass.
            # Never switch headers on 403/429, challenge HTML, robots denials,
            # redirect policy failures or ordinary 4xx.
            transient = {500, 502, 503, 504}
            if method == "search-html" and response.status_code in transient:
                self.log(method, requested, "TRANSIENT_HTTP_HEADER_FALLBACK_ONCE",
                         detail=f"initial_http_{response.status_code}; profile=alternate; backoff_2s")
                await asyncio.sleep(2.0)
                # An alternate honest Accept negotiation can change a
                # server's response representation, not our crawler identity.
                # Applied to THIS attempt only; the next request returns
                # automatically to the client's standard headers.
                fallback_headers = {
                    "Accept": "text/html,application/xhtml+xml;q=0.9,application/xml;q=0.8,*/*;q=0.5",
                    "Accept-Language": "en-US,en;q=0.8",
                }
                response = await self._raw_get(url, params, headers=fallback_headers)
                self.log(method, requested, "HEADER_PROFILE_RESTORED",
                         detail=f"baseline_next_request; retry_http_{response.status_code}")
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
        # Amazon with a caller-supplied search URL does not require a
        # homepage probe for platform detection. Save one request per query.
        if host(self.origin) in {"amazon.com", "www.amazon.com"} and self.search_url:
            homepage = None
            self.log("homepage", self.store_url + "/", "SKIPPED_EXPLICIT_SEARCH_URL")
        else:
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
                    # Inspect up to 4x the display cap WITHOUT multiplying
                    # outbound HTTP requests. PDP calls remain capped below.
                    scan_cap = min(self.maximum * 4, 40)
                    parsed = parse_jsonld(body, absolute_page) + parse_html_cards(body, absolute_page, self.origin, scan_cap)
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
        # Prioritize identity matches BEFORE spending the bounded PDP budget.
        # No category is silently deleted; the original requested max cap
        # still applies and every retained product carries its match status.
        early_rank = {"exact": 0, "related": 1, "unclassified": 2, "mismatch": 3}
        for product in products:
            product.intent_match, product.intent_reasons, product.condition = classify_product_intent(
                self.query, product.title)
        products.sort(key=lambda p: (early_rank.get(p.intent_match, 2),
                                     0 if p.price and p.currency else 1,
                                     0 if p.image else 1))
        products = products[:self.maximum]
        # PDP enrichment only for discovered links; respect page budgets.
        unresolved = (products if self.pdp == "all" else
                      [p for p in products if not p.price or not p.image] if self.pdp == "missing" else [])
        # Amazon acquisition has shown unstable 503 waves. Bound concurrent
        # detail-page requests to 2 to avoid bursts; do not increase retries.
        sem = asyncio.Semaphore(2 if host(self.origin) in {"amazon.com", "www.amazon.com"} else 3)

        async def enrich(product: Product):
            if not same_store(product.url, self.origin):
                product.issues.append("FOREIGN_PRODUCT_URL")
                return
            async with sem:
                body = await self.fetch("product-detail", product.url)
                if not body:
                    self.log("pdp-evidence", product.url, "PDP_HTTP_OR_HTML_UNAVAILABLE")
                    return
                # Amazon's PDP can carry suggested products and offer metadata.
                # Never let weak title-only JSON-LD or OG/meta prices certify
                # the current ASIN. Only the selected-ASIN-proved main buy-box
                # parser can produce Amazon price evidence.
                is_amazon = host(self.origin) in {"www.amazon.com", "amazon.com"}
                candidates = (parse_amazon_us_pdp(body, product.url) if is_amazon else
                              parse_jsonld(body, product.url) + parse_microdata(body, product.url)
                              + parse_meta_product(body, product.url))
                # Evidence from a PDP is associated only if SKU or URL aligns.
                matches = [p for p in candidates if pdp_identity_matches(product, p)]
                if not matches:
                    self.log("pdp-evidence", product.url, "PDP_IDENTITY_PROOF_NOT_MATCHED",
                             detail=f"candidates={len(candidates)}; asins={sum(bool(p.sku) for p in candidates)}")
                    return
                prices = {(p.price, p.currency) for p in matches if p.price and p.currency}
                # One bounded recovery if a valid Amazon PDP has identity and
                # image but no main price. Never retry on a missing HTTP body,
                # identity mismatch, or contradictory buy-box evidence.
                amazon_identity = any(p.method == "amazon-us-pdp-main-buybox" for p in matches)
                ambiguous = any("AMAZON_PDP_MULTIPLE_BUYBOX_PRICES" in p.issues for p in matches)
                if (not prices and amazon_identity and not ambiguous
                        and host(self.origin) in {"www.amazon.com", "amazon.com"}
                        and self._amazon_pdp_retry_budget > 0):
                    self._amazon_pdp_retry_budget -= 1
                    self.log("pdp-price-recovery", product.url, "AMAZON_MISSING_PRIMARY_PRICE_NEGOTIATION_RETRY_ONCE")
                    await asyncio.sleep(0.65)
                    retried_body = await self.fetch(
                        "product-detail-price-retry", product.url,
                        headers={"Accept": "text/html,application/xhtml+xml;q=0.9,application/xml;q=0.8,*/*;q=0.5",
                                 "Accept-Language": "en-US,en;q=0.8"})
                    if retried_body:
                        retried = parse_amazon_us_pdp(retried_body, product.url)
                        retried_matches = [p for p in retried if pdp_identity_matches(product, p)]
                        if retried_matches:
                            matches = retried_matches
                            prices = {(p.price, p.currency) for p in matches if p.price and p.currency}
                            if len(prices) == 1:
                                product.issues.append("AMAZON_PDP_RETRY_PRICE_RECOVERED")
                if not prices:
                    self.log("pdp-evidence", product.url, "PDP_MAIN_PRICE_NOT_EVIDENCED",
                             detail="identity_matched; primary_offer_missing_or_conflicted")
                if len(prices) > 1:
                    self.log("pdp-evidence", product.url, "PDP_MULTIPLE_PRICES_CONFLICT")
                    product.price = None
                    product.price_status = "conflict"
                    product.issues.append("PDP_PRICE_CONFLICT")
                elif len(prices) == 1:
                    price, currency = next(iter(prices))
                    if product.price and product.currency and (price, currency) != (product.price, product.currency):
                        self.log("pdp-evidence", product.url, "PDP_LISTING_PRICE_DISAGREEMENT")
                        product.price = None
                        product.price_status = "conflict"
                        product.issues.append("LISTING_PDP_PRICE_CONFLICT")
                    else:
                        had_listing_price = bool(product.price and product.currency)
                        product.price, product.currency = price, currency
                        # Keep provenance explicit for consumer-facing price
                        # labels: a PDP-only observation is not PLP/PDP parity.
                        product.price_source = ("search_and_pdp_agree" if had_listing_price else
                                                "pdp_main_only")
                        # A PDP alone is NOT listing-to-PDP price parity.
                        product.price_status = ("evidence_correlated" if had_listing_price
                                                else "single_source_unverified")
                        self.log("pdp-evidence", product.url,
                                 "PDP_LISTING_PRICE_MATCH" if had_listing_price
                                 else "PDP_PRICE_ONLY_UNCORRELATED")
                if not product.image:
                    product.image = next((p.image for p in matches if p.image), None)
                if not product.sku:
                    product.sku = next((p.sku for p in matches if p.sku), None)
        async def isolated_enrich(product: Product):
            try:
                await enrich(product)
            except asyncio.CancelledError:
                # Aborted requests must propagate rather than silently
                # continuing source traffic after caller cancellation.
                raise
            except Exception as exc:
                product.issues.append("PDP_ENRICHMENT_EXCEPTION")
                self.log("pdp-evidence", product.url, "PDP_ENRICHMENT_EXCEPTION",
                         detail=type(exc).__name__ + ": " + str(exc)[:120])

        await asyncio.gather(*(isolated_enrich(p) for p in unresolved[:self.maximum]))
        products = self.merge(products)
        for p in products:
            if p.price_status == "candidate":
                p.price_status = "single_source_unverified"
            if p.price and p.currency and p.price_status not in ("conflict", "evidence_correlated"):
                p.price_status = "single_source_unverified"
            if not p.price or not p.currency:
                p.price_status = "conflict" if p.price_status == "conflict" else "unresolved"
            p.issues = sorted(set(p.issues))
            p.intent_match, p.intent_reasons, p.condition = classify_product_intent(self.query, p.title)
            p.price_evidence = ("listing_pdp_agree" if p.price_status == "evidence_correlated" else
                                "single_source" if p.price and p.currency else
                                "conflict" if p.price_status == "conflict" else "unavailable")
            if p.price_status == "evidence_correlated":
                p.price_source = "search_and_pdp_agree"
            elif p.price_status == "conflict":
                p.price_source = "conflict"
            elif not p.price or not p.currency:
                p.price_source = "unavailable"
            elif p.price_source not in {"pdp_main_only", "search_and_pdp_agree"}:
                p.price_source = ("search_only" if host(self.origin) in {"amazon.com", "www.amazon.com"}
                                  else "single_source_unknown")
            p.observed_at_utc = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        # Rank, do not discard: a price-complete accessory must never displace
        # an actual console; uncertain/related offers remain visible and labeled.
        match_rank = {"exact": 0, "related": 1, "unclassified": 2, "mismatch": 3}
        products.sort(key=lambda p: (match_rank.get(p.intent_match, 2),
                                     0 if p.price_evidence == "listing_pdp_agree" else 1,
                                     0 if p.price and p.image else 1))
        products = products[:self.maximum]
        # A priced game/Portal must not make a console search seem successful.
        # Unclassified intents remain discoverable but never claim an exact fit.
        outcome = ("ok" if any(p.price and p.currency and p.intent_match != "mismatch"
                               for p in products) else "partial_or_unavailable")
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
                old.price_source = p.price_source
                old.method += "+" + p.method
            elif old.price and p.price and (old.price, old.currency) != (p.price, p.currency):
                old.price = None
                old.currency = None
                old.price_status = "conflict"
                old.price_source = "conflict"
                old.issues.append("SOURCE_PRICE_DISAGREEMENT")
            old.issues.extend(p.issues)
        return list(merged.values())

    def result(self, products: list[Product], status: str):
        # Zero cards during a 503 is unavailable source acquisition, never
        # evidence that the seller has zero inventory or products are OOS.
        search_ok = any(d.method == "search-html" and d.status == "OK"
                        for d in self.diagnostics)
        has_block = any(d.status in {"BLOCKED_OR_RATE_LIMITED", "CHALLENGE_PAGE",
                                     "ROBOTS_DENIED_OR_UNSAFE"} for d in self.diagnostics)
        transient = any(d.method == "search-html" and d.status == "HTTP_ERROR"
                        and str(d.detail) in {"500", "502", "503", "504"}
                        for d in self.diagnostics)
        if status == "robots_unavailable":
            source_availability = "robots_unavailable"
        elif has_block:
            source_availability = "access_denied"
        elif search_ok:
            source_availability = "search_accessible"
        elif transient:
            source_availability = "transient_failure"
        else:
            source_availability = "unconfirmed"
        return {"store": self.store_url, "query": self.query, "status": status,
                "source_availability": source_availability,
                "empty_means_out_of_stock": False,
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