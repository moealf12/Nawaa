"""Bounded structured-data parsing using Beautiful Soup 4 and lxml.

A search card, an AggregateOffer lowPrice, or multiple unknown SKUs are not
a single verified sellable offer. Caller retains final identity authority.
"""
import json
from typing import Any
from bs4 import BeautifulSoup
from .contracts import ProductExpectation, OfferEvidence
from .normalize import storage_from_title, model_from_title
from .prices import parse_price

MAX_SCRIPTS = 128
MAX_JSON_CHARS = 500_000

def _nodes(value: Any, depth: int = 0):
    if depth > 5:
        return
    if isinstance(value, list):
        for member in value[:128]:
            yield from _nodes(member, depth + 1)
    elif isinstance(value, dict):
        yield value
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in value:
                yield from _nodes(value[key], depth + 1)

def _types(node: dict) -> set[str]:
    raw = node.get("@type", [])
    if isinstance(raw, str):
        raw = [raw]
    return {str(t).rsplit("/", 1)[-1].casefold() for t in raw if isinstance(t, str)}

def extract_product_json_ld(html: str) -> tuple[dict | None, str]:
    if not isinstance(html, str) or len(html) > 2_000_000:
        raise ValueError("HTML_SIZE_INVALID")
    soup = BeautifulSoup(html, "lxml")
    products: list[dict] = []
    for script in soup.find_all("script", type="application/ld+json", limit=MAX_SCRIPTS):
        raw = script.string or script.get_text()
        if not raw or len(raw) > MAX_JSON_CHARS:
            continue
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError, RecursionError):
            continue
        for node in _nodes(parsed):
            if "product" in _types(node):
                products.append(node)
    # Never silently select the first of several variant products.
    if len(products) > 1:
        return None, "MULTIPLE_PRODUCT_NODES"
    if not products:
        return None, "PRODUCT_JSONLD_NOT_FOUND"
    return products[0], "PRODUCT_JSONLD_FOUND"

def _brand(node: dict) -> str | None:
    value = node.get("brand")
    if isinstance(value, dict):
        value = value.get("name")
    return value.strip() if isinstance(value, str) and value.strip() else None

def _text(node: dict, key: str) -> str | None:
    value = node.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()[:256]
    return None

def _availability(value: object) -> str:
    suffix = str(value or "").rsplit("/", 1)[-1].casefold()
    if suffix == "instock":
        return "IN_STOCK"
    if suffix == "outofstock":
        return "OUT_OF_STOCK"
    return "UNKNOWN"

def _single_offer(node: dict, expected: ProductExpectation) -> tuple[dict | None, str]:
    offers = node.get("offers")
    candidates = offers if isinstance(offers, list) else ([offers] if isinstance(offers, dict) else [])
    candidates = [o for o in candidates if isinstance(o, dict) and "aggregateoffer" not in _types(o)]
    if len(candidates) > 1 and expected.sku is not None:
        candidates = [o for o in candidates if str(o.get("sku") or "") == expected.sku]
    if not candidates:
        return None, "SELLABLE_OFFER_NOT_FOUND"
    if len(candidates) > 1:
        return None, "MULTIPLE_OFFERS_AMBIGUOUS"
    offer = candidates[0]
    if "aggregateoffer" in _types(offer):
        return None, "AGGREGATE_PRICE_NOT_SELLABLE"
    return offer, "SINGLE_OFFER"

def extract_html(html: str, expected: ProductExpectation) -> tuple[ProductExpectation | None, OfferEvidence | None, str]:
    product, state = extract_product_json_ld(html)
    if product is None:
        return None, None, state
    title = _text(product, "name")
    attrs: dict[str, object] = {
        "brand": _brand(product),
        "model": _text(product, "model") or (model_from_title(title or "") if title else None),
        "storageGb": storage_from_title(title) if title else None,
        "condition": None,
        "bundleId": None,
        "sku": _text(product, "sku"),
        "gtin": next((_text(product, key) for key in ("gtin14", "gtin13", "gtin12", "gtin8", "gtin") if _text(product, key)), None),
        "color": _text(product, "color"),
        "title": title
    }
    if isinstance(product.get("itemCondition"), str):
        condition = str(product["itemCondition"]).casefold()
        if "refurbished" in condition:
            attrs["condition"] = "REFURBISHED"
        elif "used" in condition:
            attrs["condition"] = "USED"
        elif "new" in condition:
            attrs["condition"] = "NEW"
    try:
        observed = ProductExpectation.model_validate(attrs)
    except ValueError:
        return None, None, "PRODUCT_FIELDS_INVALID"
    offer, offer_state = _single_offer(product, expected)
    if offer is None:
        return observed, None, offer_state
    # A priced Offer bound to a different SKU must never enrich the Product.
    # Missing offer SKU is tolerated only for a single, unambiguous Product Offer.
    offer_sku = offer.get("sku")
    product_sku = product.get("sku")
    if isinstance(offer_sku, str) and offer_sku.strip():
        if isinstance(product_sku, str) and product_sku.strip() and offer_sku.strip() != product_sku.strip():
            return observed, None, "OFFER_PRODUCT_SKU_MISMATCH"
        if expected.sku is not None and offer_sku.strip() != expected.sku:
            return observed, None, "OFFER_EXPECTED_SKU_MISMATCH"
    raw_price = offer.get("price")
    if raw_price is None or raw_price == "":
        return observed, None, "PRICE_NOT_FOUND"
    try:
        evidence = parse_price(raw_price, offer.get("priceCurrency"), _availability(offer.get("availability")))
    except ValueError:
        return observed, None, "PRICE_EVIDENCE_INVALID"
    return observed, evidence, "STRUCTURED_OFFER_EXTRACTED"
