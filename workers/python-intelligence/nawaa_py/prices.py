"""Decimal price evidence: no fabricated zero price or inferred currency."""
from decimal import Decimal, InvalidOperation
import re
from .contracts import OfferEvidence

PRICE = re.compile(r"^\d+(?:\.\d{1,2})?$")
CURRENCY = re.compile(r"^[A-Z]{3}$")

def parse_price(value: object, currency: object, availability: str = "UNKNOWN") -> OfferEvidence:
    # JSON-LD numeric prices can be int or exact decimal text; floats are
    # converted only from the JSON lexical representation, then validated.
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("PRICE_TYPE_INVALID")
    number = str(value)
    if not PRICE.fullmatch(number) or len(number) > 40:
        raise ValueError("PRICE_FORMAT_INVALID")
    if not isinstance(currency, str) or not CURRENCY.fullmatch(currency):
        raise ValueError("CURRENCY_MISSING_OR_INVALID")
    try:
        amount = Decimal(number)
    except InvalidOperation as exc:
        raise ValueError("PRICE_INVALID") from exc
    if not amount.is_finite() or amount <= 0:
        raise ValueError("PRICE_NONPOSITIVE")
    if availability not in ("IN_STOCK", "OUT_OF_STOCK", "UNKNOWN"):
        raise ValueError("AVAILABILITY_INVALID")
    return OfferEvidence(price=amount, currency=currency, availability=availability)

def normalize_price(value: str, currency: str) -> dict[str, str]:
    evidence = parse_price(value, currency)
    return {"price": f"{evidence.price:.2f}", "currency": evidence.currency}
