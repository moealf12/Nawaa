"""Fail-closed price evidence comparison for public Noon UAE listing vs PDP.

Source-agnostic arithmetic and identity policy; no networking or publishing.
An SEO Offer without matching offer-code identity cannot certify a buybox.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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


def corroborate_sources(*, plp_price, ast_candidates, jsonld_offers):
    """Independent PLP + source offer + Product JSON-LD agreement.

    Currency on an SEO Product Offer is product-level evidence, not a
    merchant buybox same-offer currency attestation. This diagnostic
    can never independently grant customer publishability.
    """
    expected = cents(plp_price)
    if expected is None or not isinstance(ast_candidates, list) or not isinstance(jsonld_offers, list):
        return {"state": "INSUFFICIENT_SOURCE_EVIDENCE",
                "sameOfferCurrencyAttested": False, "customerPublishable": False}
    same_offer = [
        x for x in ast_candidates
        if isinstance(x, dict)
        and x.get("sameSku") is True
        and x.get("skuExplicitInOfferRecord") is True
        and x.get("skuAliasesConflict") is False
        and x.get("priceKind") in ("saleprice", "currentprice", "sellingprice", "offerprice", "price")
        and type(x.get("priceCents")) is int
    ]
    values = {x["priceCents"] for x in same_offer}
    # Reject inconsistent prices tied to the same code, instead of selecting
    # the cheapest/first. Never use list-price as a second buybox candidate.
    if len(values) > 1:
        state = "CONFLICTING_OFFER_PRICE_EVIDENCE"
    elif not values or expected not in values:
        state = "SOURCE_OFFER_PRICE_NOT_MATCHED"
    else:
        same_product_currency = any(
            isinstance(o, dict) and o.get("currency") == "AED"
            and cents(o.get("price")) == expected
            for o in jsonld_offers
        )
        currency_in_same_offer = any(x.get("currency") == "AED" for x in same_offer)
        if currency_in_same_offer:
            state = "SAME_OFFER_AMOUNT_AND_AED_ATTESTED_NO_DELIVERY_PROOF"
        elif same_product_currency:
            state = "OFFER_PRICE_PRODUCT_AED_CORROBORATED_CURRENCY_NOT_PER_OFFER"
        else:
            state = "PRODUCT_CURRENCY_OR_PRICE_NOT_CORROBORATED"
    return {
        "state": state,
        "sameOfferCurrencyAttested": state == "SAME_OFFER_AMOUNT_AND_AED_ATTESTED_NO_DELIVERY_PROOF",
        "productCurrencyCorroborated": state in (
            "OFFER_PRICE_PRODUCT_AED_CORROBORATED_CURRENCY_NOT_PER_OFFER",
            "SAME_OFFER_AMOUNT_AND_AED_ATTESTED_NO_DELIVERY_PROOF",
        ),
        "customerPublishable": False,
    }


# Indicative conversion only, observed rate on 2026-11-05.
# Callers must establish AED independently; this function cannot attest currency.
AED_TO_SAR_ESTIMATE_RATE = Decimal("1.023")


def aed_to_sar_estimate(price_aed):
    """Convert a validated AED amount to an approximate SAR display amount."""
    amount_cents = cents(price_aed)
    if amount_cents is None:
        return None
    converted = (Decimal(amount_cents) / 100 * AED_TO_SAR_ESTIMATE_RATE).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    return str(converted)


AED_TO_SAR_ESTIMATE_AS_OF = "2026-11-05"


def aed_sar_card_preview(price, *, market, explicit_aed_label):
    """Diagnostic-only conversion for an observed PLP card.

    Never assert AED from the source route or from product-level evidence.
    Unattested currency yields a clearly conditional scenario, not a display
    price. No branch authorizes a customer offer or live exchange quote.
    """
    valid_market = market == "AE"
    valid_price = cents(price) is not None
    attested = valid_market and valid_price and explicit_aed_label is True
    scenario = aed_to_sar_estimate(price) if valid_market and valid_price else None
    return {
        "sourceCurrencyVerified": "AED" if attested else None,
        "sourceCurrencyEvidence": (
            "EXPLICIT_PLP_PRICE_LABEL" if attested else
            "NO_PER_CARD_AED_ATTESTATION"
        ),
        "convertedSarApprox": scenario if attested else None,
        "sarScenarioIfAED": scenario if scenario is not None and not attested else None,
        "fxRateAedSar": str(AED_TO_SAR_ESTIMATE_RATE) if scenario is not None else None,
        "fxRateAsOf": AED_TO_SAR_ESTIMATE_AS_OF if scenario is not None else None,
        "fxKind": "FIXED_INDICATIVE_REFERENCE_NOT_LIVE",
        "customerPublishable": False,
    }
