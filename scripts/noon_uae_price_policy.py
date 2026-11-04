"""Fail-closed price evidence comparison for public Noon UAE listing vs PDP.

Source-agnostic arithmetic and identity policy; no networking or publishing.
An SEO Offer without matching offer-code identity cannot certify a buybox.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlsplit

SKU = re.compile(r"(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)", re.I)
MONEY = re.compile(r"(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?")


def cents(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return None
    text = str(value).strip()
    if not MONEY.fullmatch(text):
        return None
    try:
        amount = Decimal(text)
        result = amount * 100
        if amount <= 0 or result > 9999999999 or result != result.to_integral_value():
            return None
        return int(result)
    except (ValueError, InvalidOperation):
        return None


def matching_offer_link(raw_url, sku, offer):
    if not isinstance(raw_url, str) or not isinstance(offer, str):
        return False
    if not re.fullmatch(r"[a-zA-Z0-9-]{1,100}", offer):
        return False
    try:
        url = urlsplit(raw_url)
        return (
            url.scheme == "https"
            and url.hostname == "www.noon.com"
            and url.username is None and url.password is None
            and url.port in (None, 443)
            and url.path.startswith("/uae-en/")
            and url.path.rstrip("/").endswith("/" + sku + "/p")
            and parse_qs(url.query).get("o", []) == [offer]
        )
    except ValueError:
        return False


def assess_offer(*, requested_sku, product_sku, plp_price, pdp_price,
                 currency, requested_offer_code, offer_url=None):
    """Return evidence with an explicit safe decision, never inferred AED."""
    sku = str(requested_sku or "").upper()
    observed = str(product_sku or "").upper()
    plp = cents(plp_price)
    pdp = cents(pdp_price)
    same_sku = bool(SKU.fullmatch(sku)) and sku == observed
    country_currency = str(currency or "").strip().upper() == "AED"
    same_offer = matching_offer_link(offer_url, sku, requested_offer_code)
    delta = pdp - plp if plp is not None and pdp is not None else None
    proven = (same_sku and country_currency and same_offer and delta == 0)
    if not same_sku:
        decision = "SKU_MISMATCH"
    elif not country_currency:
        decision = "CURRENCY_NOT_ATTESTED_AS_AED"
    elif delta is None:
        decision = "PRICE_MISSING_OR_INVALID"
    elif delta != 0:
        decision = "CROSS_SURFACE_AMOUNT_DIFFERS"
    elif not same_offer:
        decision = "PRICE_MATCHES_BUT_OFFER_IDENTITY_UNKNOWN"
    else:
        decision = "SAME_OFFER_PRICE_AND_CURRENCY_VERIFIED"
    return {
        "decision": decision,
        "sameSku": same_sku,
        "aedFromProductOffer": country_currency and same_sku,
        "sameOfferIdentity": same_offer,
        "deltaCents": delta,
        "verified": proven,
        "customerPublishable": False,  # requires independent freshness/market/shipping gates
    }
