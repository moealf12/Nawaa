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
