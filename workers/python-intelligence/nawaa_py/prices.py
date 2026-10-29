"""Exact decimal evidence, not a currency conversion or price attestation."""
from decimal import Decimal, InvalidOperation
import re

ISO_CURRENCY = re.compile(r"^[A-Z]{3}$")


def normalize_price(value: str, currency: str) -> dict[str, str]:
    if not isinstance(value, str) or not isinstance(currency, str):
        raise ValueError("PRICE_INPUT_TYPE")
    if not ISO_CURRENCY.fullmatch(currency):
        raise ValueError("CURRENCY_INVALID")
    if not re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", value):
        raise ValueError("PRICE_FORMAT_INVALID")
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("PRICE_INVALID") from exc
    if not amount.is_finite() or amount <= 0:
        raise ValueError("PRICE_NONPOSITIVE")
    return {"price": f"{amount:.2f}", "currency": currency}
