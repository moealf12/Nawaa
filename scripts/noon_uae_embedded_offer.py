"""Strict, bounded, read-only decoder for inlined JSON-backed Noon offers.

Never executes JavaScript. Lexical occurrence or proximity to a price is not
offer identity. Only a parsed record that ties exact SKU + offer code + explicit
AED + amount can support a price parity assessment. No customer publishing.
"""
from __future__ import annotations

import json
import re

from noon_uae_price_policy import cents

MAX_SCRIPT_CHARS = 3_000_000
MAX_SCRIPTS = 100
MAX_RECORDS = 6000
MAX_DEPTH = 18
MAX_CANDIDATES = 12
MAX_JSON_PARSE_ATTEMPTS = 32
ASSIGNMENT = re.compile(
    r"(?:window|self|globalThis)\.[A-Za-z_$][\w$]*(?:\[['\"][A-Za-z_$][\w$]*['\"]\])?"
    r"\s*=\s*(?=[{\[])"
)
JSON_PARSE = re.compile(r"\bJSON\.parse\s*\(\s*(?=['\"])")
OFFER_KEYS = frozenset(("offercode", "offerid"))
SKU_KEYS = frozenset(("sku", "skuconfig", "productsku"))
CURRENCY_KEYS = frozenset(("currency", "currencycode", "pricecurrency"))
PRICE_KEYS = frozenset(("price", "saleprice", "sellingprice", "offerprice", "currentprice"))


def _key(k):
    return re.sub(r"[^a-z0-9]", "", str(k).lower())


def _record_value(record, names):
    return [v for k, v in record.items() if _key(k) in names]


def _amount_and_currency(record):
    result = []
    currency_values = [
        str(v).upper().strip() for v in _record_value(record, CURRENCY_KEYS)
        if isinstance(v, str)
    ]
    for k, v in record.items():
        if _key(k) not in PRICE_KEYS:
            continue
        if isinstance(v, dict):
            a = _record_value(v, frozenset(("amount", "value", "price")))
            cs = _record_value(v, CURRENCY_KEYS)
            if len(a) == 1:
                result.append((a[0], str(cs[0]).upper().strip() if len(cs) == 1 else None))
        else:
            if not isinstance(v, bool):
                result.append((v, currency_values[0] if len(set(currency_values)) == 1 else None))
    return result


def candidate_objects(decoded, *, sku, offer_code, plp_price):
    """Demand exact record structure; return evidence, never merchant offers."""
    expected_sku = str(sku).upper()
    plp_cents = cents(plp_price)
    seen = 0
    stack = [(decoded, None, 0)]
    evidence = []
    while stack and seen < MAX_RECORDS:
        node, parent_sku, depth = stack.pop()
        seen += 1
        if depth > MAX_DEPTH:
            continue
        if isinstance(node, list):
            stack.extend((value, parent_sku, depth + 1) for value in node[:100])
            continue
        if not isinstance(node, dict):
            continue
        own_skus = [
            str(v).upper() for v in _record_value(node, SKU_KEYS)
            if isinstance(v, str)
        ]
        current_sku = own_skus[0] if len(own_skus) == 1 else (
            parent_sku if not own_skus else None
        )
        own_offers = [
            v for v in _record_value(node, OFFER_KEYS) if isinstance(v, str)
        ]
        exact_offer = offer_code in own_offers
        if exact_offer and len(evidence) < MAX_CANDIDATES:
            prices = _amount_and_currency(node)
            if not prices:
                evidence.append({"state": "EXACT_OFFER_WITHOUT_DIRECT_PRICE",
                                 "sameSku": current_sku == expected_sku,
                                 "priceCents": None, "currency": None,
                                 "amountMatchesPlp": False, "publishable": False})
            else:
                for price, currency in prices[:4]:
                    amount_cents = cents(price)
                    evidence.append({
                        "state": (
                            "EXACT_OFFER_AMOUNT_CURRENCY_MATCHED_UNPUBLISHED"
                            if current_sku == expected_sku
                            and currency == "AED"
                            and amount_cents is not None and amount_cents == plp_cents
                            else "EXACT_OFFER_PRICE_OR_PROVENANCE_MISMATCH"
                        ),
                        "sameSku": current_sku == expected_sku,
                        "skuExplicitInOfferRecord": own_skus == [expected_sku],
                        "priceCents": amount_cents,
                        "currency": currency,
                        "amountMatchesPlp": amount_cents is not None and amount_cents == plp_cents,
                        "deltaCents": (
                            amount_cents - plp_cents
                            if amount_cents is not None and plp_cents is not None
                            else None
                        ),
                        "publishable": False,
                    })
        for v in node.values():
            if isinstance(v, (list, dict)):
                stack.append((v, current_sku, depth + 1))
    return evidence[:MAX_CANDIDATES], seen


def _iter_objects(script, content_type):
    decoder = json.JSONDecoder()
    if content_type in ("application/ld+json", "application/json"):
        try:
            yield json.loads(script), "json_script"
        except (TypeError, ValueError):
            pass
    for pattern in (ASSIGNMENT, JSON_PARSE):
        for match in list(pattern.finditer(script))[:MAX_JSON_PARSE_ATTEMPTS]:
            tail = script[match.end():]
            try:
                if pattern is JSON_PARSE:
                    raw, _ = decoder.raw_decode(tail)
                    if not isinstance(raw, str) or len(raw) > MAX_SCRIPT_CHARS:
                        continue
                    obj = json.loads(raw)
                    yield obj, "json_parse_literal"
                else:
                    obj, _ = decoder.raw_decode(tail)
                    yield obj, "js_json_assignment"
            except (TypeError, ValueError):
                pass
    return


def inspect_offer_scripts(soup, *, sku, offer_code, plp_price):
    """Bounded schema checks only; no external calls or JavaScript execution."""
    summary = {
        "scriptsInspected": 0,
        "scriptsContainingOfferText": 0,
        "jsonObjectsDecoded": 0,
        "decodedPathCounts": {},
        "offerCandidateRecords": [],
        "exactOfferWithExplicitSkuCurrencyPrice": False,
        "samePriceOfferAttested": False,
        "maxNodesPerDecodedObject": MAX_RECORDS,
        "customerPublishable": False,
    }
    if not re.fullmatch(r"[A-Za-z0-9-]{1,100}", str(offer_code)):
        return summary
    if not re.fullmatch(r"(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)", str(sku), re.I):
        return summary
    scripts = soup.find_all("script", limit=MAX_SCRIPTS)
    for node in scripts:
        data = node.string or node.get_text()
        if not isinstance(data, str) or not data or len(data) > MAX_SCRIPT_CHARS:
            continue
        summary["scriptsInspected"] += 1
        if offer_code not in data:
            continue
        summary["scriptsContainingOfferText"] += 1
        content_type = str(node.get("type") or "").lower().strip()
        for obj, kind in _iter_objects(data, content_type):
            summary["jsonObjectsDecoded"] += 1
            summary["decodedPathCounts"][kind] = summary["decodedPathCounts"].get(kind, 0) + 1
            offers, _ = candidate_objects(
                obj, sku=sku, offer_code=offer_code, plp_price=plp_price
            )
            for offer in offers:
                if len(summary["offerCandidateRecords"]) < MAX_CANDIDATES:
                    summary["offerCandidateRecords"].append(offer)
                same_sku = offer["sameSku"] and offer.get("skuExplicitInOfferRecord")
                if same_sku and offer.get("currency") == "AED" and offer["priceCents"] is not None:
                    summary["exactOfferWithExplicitSkuCurrencyPrice"] = True
                    if offer["amountMatchesPlp"]:
                        summary["samePriceOfferAttested"] = True
    return summary
