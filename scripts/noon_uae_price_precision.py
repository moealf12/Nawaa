"""Precision-preserving PLP versus offer-linked PDP price interpretation.

No rounding, flooring, currency inference or implicit tolerance is performed.
A whole-number PLP card can be an abbreviated presentation, not evidence of
an exact amount, if the corresponding source PDP has fractional units.
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

_DECIMAL = re.compile(
    r"(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?|[1-9]\d{0,2}(?:,\d{3})+(?:\.\d{1,2})?"
)
_PRECISION = re.compile(r"\.(\d{1,2})$")


def _display(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    cleaned = value.strip().replace("\u00a0", "")
    if not _DECIMAL.fullmatch(cleaned):
        return None
    digits = _PRECISION.search(cleaned)
    decimal_places = len(digits.group(1)) if digits else 0
    try:
        decimal = Decimal(cleaned.replace(",", ""))
    except InvalidOperation:
        return None
    if not decimal.is_finite() or not Decimal("0") < decimal <= Decimal("99999999.99"):
        return None
    return {
        "cents": int(decimal * 100),
        "displayedDecimalPlaces": decimal_places,
    }


def interpret_price_surfaces(plp_text, pdp_cents):
    """Classify independent source surfaces, retain exact cents as observed.

    Returns only diagnostic evidence. No branch automatically certifies
    same-offer, currency, or publication.
    """
    parsed = _display(plp_text)
    if (parsed is None or type(pdp_cents) is not int
            or not 1 <= pdp_cents <= 9999999999):
        return {
            "state": "INVALID_PRICE_EVIDENCE",
            "displayPrecision": None,
            "deltaCents": None,
            "exactEqualityAttested": False,
            "customerPublishable": False,
        }
    diff = pdp_cents - parsed["cents"]
    places = parsed["displayedDecimalPlaces"]
    if diff == 0:
        state = "EXACT_NUMERIC_PRICE_MATCH"
    elif places < 2 and abs(diff) < 100 and pdp_cents % 100 != 0:
        # Could be rounding/truncation, but without the site's rendering
        # contract we cannot infer which. Preserve precise source cents.
        state = "COARSE_PL_DISPLAY_FRACTIONAL_PDP_UNRESOLVED"
    else:
        state = "PRICE_DIFFERENCE_UNRESOLVED"
    return {
        "state": state,
        "displayPrecision": places,
        "plpDisplayedCents": parsed["cents"],
        "pdpObservedCents": pdp_cents,
        "deltaCents": diff,
        "exactEqualityAttested": diff == 0,
        "customerPublishable": False,
    }



def select_source_current_offer_amount(candidate_records):
    """Resolve exactly one offer-linked amount with sale-price precedence.

    Only inspect already SKU/offer-code-matched AST records. A list price is
    never preferred to an explicit sale price. Return source amount only, not
    currency or merchant live-buybox verification.
    """
    if not isinstance(candidate_records, list):
        return {"state": "INVALID_CANDIDATES", "priceCents": None}
    valid = [
        record for record in candidate_records if isinstance(record, dict)
        and record.get("sameSku") is True
        and record.get("skuExplicitInOfferRecord") is True
        and record.get("skuAliasesConflict") is False
        and record.get("priceKind") in (
            "saleprice", "currentprice", "sellingprice", "offerprice", "price"
        )
        and type(record.get("priceCents")) is int
        and 0 < record["priceCents"] <= 9999999999
    ]
    if not valid:
        return {"state": "NO_CURRENT_SOURCE_AMOUNT", "priceCents": None}
    preferred = [
        x for x in valid
        if x["priceKind"] in ("saleprice", "currentprice", "sellingprice", "offerprice")
    ]
    selected = preferred if preferred else valid
    distinct = {x["priceCents"] for x in selected}
    if len(distinct) != 1:
        return {
            "state": "CONFLICTING_CURRENT_SOURCE_AMOUNTS",
            "priceCents": None,
            "competingAmounts": len(distinct),
        }
    return {
        "state": "UNIQUE_OFFER_LINKED_SOURCE_AMOUNT_NOT_CURRENCY_ATTESTED",
        "priceCents": next(iter(distinct)),
        "priceKinds": sorted({x["priceKind"] for x in selected}),
        "evidenceRecords": len(selected),
    }



def corroborate_selected_pdp_offer_amount(ast_records, product_jsonld_offers):
    """Compare exact selected-source offer amount to same-SKU PDP JSON-LD.

    Caller must have already validated a single matching SKU and origin.
    This is product-level currency *corroboration*, NOT a direct per-offer
    currency claim. Does not infer any shipping or make an offer publishable.
    """
    current = select_source_current_offer_amount(ast_records)
    amount = current.get("priceCents")
    result = {
        "state": "PDP_OFFER_SOURCE_UNVERIFIED",
        "selectedSourceOfferPriceCents": amount,
        "productCurrencyCorroborated": None,
        "sourceOfferAmountProductPriceCorroborated": False,
        "offerCurrencyDirectlyVerified": False,
        # The merchant's Product JSON-LD and TanStack offer record are two
        # representations from the same PDP, NOT independent merchants.
        "currencyEvidenceTier": "UNVERIFIED",
        "sourceRepresentationCount": 0,
        "customerPublishable": False,
    }
    if type(amount) is not int or not isinstance(product_jsonld_offers, list):
        return result
    pairs = set()
    for offer in product_jsonld_offers:
        if not isinstance(offer, dict):
            return result
        currency = offer.get("currency")
        price = offer.get("priceCents")
        if not isinstance(currency, str) or type(price) is not int:
            return result
        pairs.add((currency.upper().strip(), price))
    if not pairs:
        result["state"] = "PDP_PRODUCT_CURRENCY_PRICE_MISSING"
        return result
    if len(pairs) != 1:
        result["state"] = "PDP_PRODUCT_OFFERS_CONFLICTING"
        return result
    currency, product_price = next(iter(pairs))
    if product_price != amount:
        result["state"] = "PDP_PRODUCT_OFFER_AMOUNT_MISMATCH"
        return result
    if currency != "AED":
        result["state"] = "PDP_PRODUCT_CURRENCY_NOT_AED"
        return result
    result["productCurrencyCorroborated"] = "AED"
    result["sourceOfferAmountProductPriceCorroborated"] = True
    result["sourceRepresentationCount"] = 2
    same_offer = [
        row for row in ast_records if isinstance(row, dict)
        and row.get("sameSku") is True
        and row.get("skuExplicitInOfferRecord") is True
        and row.get("skuAliasesConflict") is False
        and type(row.get("priceCents")) is int
        and row["priceCents"] == amount
        and row.get("priceKind") in (
            "saleprice", "currentprice", "sellingprice", "offerprice", "price"
        )
    ]
    direct_currencies = {
        str(row["currency"]).upper().strip() for row in same_offer
        if isinstance(row.get("currency"), str) and row["currency"].strip()
    }
    if direct_currencies == {"AED"}:
        result["state"] = "OFFER_CURRENCY_AED_DIRECT_AND_PRODUCT_CORROBORATED"
        result["currencyEvidenceTier"] = "OFFER_DIRECT"
        result["offerCurrencyDirectlyVerified"] = True
    elif direct_currencies:
        # Conflicting source-offer currency cannot be overridden by a
        # product-level AED currency even if the numeric amount agrees.
        result["state"] = "OFFER_PRODUCT_CURRENCY_CONFLICT"
        result["currencyEvidenceTier"] = "CONFLICTED"
        result["sourceOfferAmountProductPriceCorroborated"] = False
        result["productCurrencyCorroborated"] = None
    else:
        result["state"] = "OFFER_PRICE_MATCHES_PRODUCT_AED_PRICE_NOT_SAME_OFFER_CURRENCY"
        result["currencyEvidenceTier"] = "PRODUCT_SAME_SKU_EXACT_AMOUNT"
    return result
