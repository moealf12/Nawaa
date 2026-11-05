"""Conservative AliExpress product-page DOM evidence; no network or CAPTCHA logic.

A DOM price is useful only when anchored to the real product document and
its explicit currency. Nothing here certifies variant selection, the seller,
shipping, redirect aliases, or customer publication.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

ALLOWED_HOSTS = frozenset({
    "ar.aliexpress.com", "www.aliexpress.com", "m.aliexpress.com",
    "aliexpress.com", "www.aliexpress.us", "aliexpress.us",
})
ITEM = re.compile(r"^/item/(\d{10,20})\.html/?$", re.I)
CURRENCY = re.compile(r"^[A-Z]{3}$")
PRICE = re.compile(r"^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$")
BAD_PRICE_CLASS = re.compile(
    r"(?:original|old-price|previous|list-price|retail-price|crossed|strikethrough)",
    re.I,
)
MAX_DOCUMENT = 3_500_000
MAX_ELEMENTS = 35_000
MAX_VARIANT_OPTIONS = 60


def canonical_item_id(raw, page_url):
    """Only genuine HTTPS AliExpress PDP URLs can establish a page identity."""
    if not isinstance(raw, str) or not 0 < len(raw) <= 2400:
        return None
    try:
        uri = urlsplit(urljoin(page_url, raw))
        if (uri.scheme != "https" or uri.hostname not in ALLOWED_HOSTS
                or uri.username or uri.password or uri.port not in (None, 443)):
            return None
        match = ITEM.fullmatch(uri.path)
        return match.group(1) if match else None
    except (ValueError, TypeError):
        return None


def exact_decimal(raw):
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)):
        return None
    value = str(raw).strip()
    if not PRICE.fullmatch(value):
        return None
    try:
        amount = Decimal(value)
        if not amount.is_finite() or amount <= 0 or amount >= 10_000_000:
            return None
        return str(amount.quantize(Decimal("0.01")))
    except InvalidOperation:
        return None


def first_attr(node, attr, default=None):
    raw = node.get(attr) if node is not None else None
    return raw.strip() if isinstance(raw, str) and raw.strip() else default


def field_value(node):
    if node is None:
        return None
    return first_attr(node, "content") or first_attr(node, "value") or (
        node.get_text(" ", strip=True)[:100] or None
    )


def price_pair(value, currency, method, *, selected_variant=None):
    amount = exact_decimal(value)
    if amount is None or not isinstance(currency, str):
        return None
    currency = currency.strip()
    if not CURRENCY.fullmatch(currency):
        return None
    return {
        "priceOriginal": amount,
        "currency": currency,
        "method": method,
        "selectedVariantId": selected_variant,
    }


def selected_variant_status(root):
    """Report selection ambiguity, never guess default or cheapest SKU."""
    selectors = root.select(
        "select[name*=sku], select[name*=variant], "
        "select[id*=sku], select[id*=variant]"
    )[:10]
    variant_fields = []
    for select in selectors:
        opts = [o for o in select.select("option")[:MAX_VARIANT_OPTIONS]
                if not o.has_attr("disabled") and first_attr(o, "value")]
        if len(opts) > 1:
            selected = [o for o in opts if o.has_attr("selected")]
            variant_fields.append("EXPLICIT" if len(selected) == 1 else "AMBIGUOUS")
    if "AMBIGUOUS" in variant_fields:
        return "MULTIPLE_VARIANTS_NOT_SELECTED"
    if variant_fields:
        return "SELECTION_IN_DOM_NOT_BUYBOX_VERIFIED"
    return "UNKNOWN_NO_EXPLICIT_VARIANT_CONTRACT"


def read_pdp_dom_evidence(html, item_id, page_url):
    """Inspect first-party product DOM without inventing an item or price."""
    base = {
        "state": "DOM_NOT_INSPECTED", "identityState": "UNVERIFIED",
        "pageItemId": None, "identitySources": [],
        "priceCandidate": None, "priceMethods": [],
        "titleCandidate": None, "variantState": "UNKNOWN",
        "visiblePriceElements": 0,
        "customerPublishable": False, "pdpPriceVerified": False,
    }
    if (not isinstance(html, str) or len(html) > MAX_DOCUMENT
            or not re.fullmatch(r"\d{10,20}", str(item_id))
            or canonical_item_id(page_url, page_url) != str(item_id)):
        base["state"] = "DOM_INPUT_OR_DOCUMENT_ID_INVALID"
        return base

    document = BeautifulSoup(html, "html.parser")
    if len(document.find_all(True, limit=MAX_ELEMENTS + 1)) > MAX_ELEMENTS:
        base["state"] = "DOM_TOO_MANY_ELEMENTS"
        return base
    identities = []
    for link in document.select('link[rel~="canonical"][href]')[:8]:
        identities.append(("canonical", canonical_item_id(link.get("href"), page_url)))
    for meta in document.select('meta[property="og:url"][content]')[:8]:
        identities.append(("og:url", canonical_item_id(meta.get("content"), page_url)))
    if not identities:
        base["state"] = "DOM_PAGE_ID_NOT_ATTESTED"
        return base
    distinct = {value for _, value in identities}
    base["identitySources"] = sorted({kind for kind, _ in identities})
    if distinct != {str(item_id)}:
        base["state"] = "DOM_CANONICAL_ID_CONFLICT"
        return base
    base["identityState"] = "SAME_ITEM_CANONICAL_ATTESTED"
    base["pageItemId"] = str(item_id)

    h1 = document.select_one("main h1, h1.product-title-text, h1")
    if h1:
        title = h1.get_text(" ", strip=True)
        if 3 <= len(title) <= 250:
            base["titleCandidate"] = title

    main = document.select_one("main")
    base["variantState"] = selected_variant_status(main or document)

    candidates = []

    # Independent head metadata: reject duplicate/conflicting amount or
    # currency tags rather than silently accepting only the first tag.
    for prefix in ("product:price:", "og:price:"):
        amounts = [
            field_value(node) for node in document.select(
                'head meta[property="' + prefix + 'amount"][content]'
            )[:12]
        ]
        currencies = [
            field_value(node) for node in document.select(
                'head meta[property="' + prefix + 'currency"][content]'
            )[:12]
        ]
        if len(set(amounts)) > 1 or len(set(currencies)) > 1:
            base["state"] = "DOM_PRICE_EVIDENCE_CONFLICT"
            return base
        pair = price_pair(
            amounts[0] if amounts else None,
            currencies[0] if currencies else None,
            "DOM_HEAD_" + prefix.replace(":", "_").upper(),
        )
        if pair:
            candidates.append(pair)

    # Microdata and widget data are restricted to the product's main region.
    # An unscoped related-products carousel outside main never owns the PDP
    # price. On pages without <main>, microdata requires an exact item URL.
    scope_root = main or document
    scopes = scope_root.select(
        '[itemscope][itemtype*="schema.org/Product"], '
        '[itemscope][itemtype*="schema.org/product"]'
    )[:8]
    for scope in scopes:
        item_url = first_attr(scope, "itemid")
        if not item_url:
            url_node = scope.select_one('[itemprop="url"]')
            item_url = (first_attr(url_node, "href")
                        or first_attr(url_node, "content"))
        if (item_url and canonical_item_id(item_url, page_url) != str(item_id)
                or not main and not item_url):
            continue
        amount = scope.select_one('[itemprop="price"]')
        currency = scope.select_one('[itemprop="priceCurrency"]')
        pair = price_pair(
            field_value(amount), field_value(currency), "DOM_PRODUCT_MICRODATA"
        )
        if pair:
            candidates.append(pair)

    # Merchant-rendered widget: product ID, current price, and currency
    # must all belong to one product-root element in the PDP's main region.
    for root in scope_root.select("[data-product-id][data-price-current][data-currency]")[:20]:
        if first_attr(root, "data-product-id") != str(item_id):
            continue
        pair = price_pair(
            first_attr(root, "data-price-current"),
            first_attr(root, "data-currency"), "DOM_EXACT_ITEM_DATA_ATTRIBUTES",
            selected_variant=first_attr(root, "data-selected-sku"),
        )
        if pair:
            candidates.append(pair)

    # Visible price signals are counted for diagnostics only. Text such as
    # "$2.99" may be a coupon, selected/other SKU, list price, or variant min.
    # Do not promote this unauthenticated text into verified product prices.
    if main is not None:
        for node in main.select(
            "[class*=price], [data-price], [itemprop=price]"
        )[:80]:
            classes = " ".join(node.get("class", []))
            if node.name in {"s", "del", "strike"} or BAD_PRICE_CLASS.search(classes):
                continue
            if node.get_text(" ", strip=True):
                base["visiblePriceElements"] += 1

    base["priceMethods"] = sorted({c["method"] for c in candidates})
    if not candidates:
        base["state"] = "DOM_CURRENT_PRICE_WITH_EXPLICIT_CURRENCY_MISSING"
        return base
    values = {(c["priceOriginal"], c["currency"]) for c in candidates}
    if len(values) != 1:
        base["state"] = "DOM_PRICE_EVIDENCE_CONFLICT"
        return base
    # One unambiguous price, but only an observation of DOM; not a proof
    # that the selected variant or merchant buybox will honor that price.
    base["priceCandidate"] = {
        "priceOriginal": candidates[0]["priceOriginal"],
        "currency": candidates[0]["currency"],
        "evidenceTier": "SAME_CANONICAL_ITEM_DOM_PRICE_CANDIDATE",
    }
    base["state"] = (
        "DOM_PRICE_CANDIDATE_VARIANT_AMBIGUOUS"
        if base["variantState"] == "MULTIPLE_VARIANTS_NOT_SELECTED"
        else "DOM_PRICE_CANDIDATE_NOT_BUYBOX_VERIFIED"
    )
    return base
