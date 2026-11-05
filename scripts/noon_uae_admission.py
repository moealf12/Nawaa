"""Explainable, fail-closed source admission diagnostics for the Noon UAE probe.

This module never admits a customer price merely because a fetch/test passed.
The evidence is expected from internal parsers and independently verified
partner signatures. A source HTTP 200 is NOT a release-approval signal.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from noon_uae_price_policy import cents

SKU = re.compile(r"(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)", re.I)
REQUIRED_STAGES = ("warmup", "plp_live", "one_offer_linked_pdp")


def _dict(value):
    return value if isinstance(value, dict) else {}


def evaluate_noon_uae_admission(report, *, now_utc=None, max_age_s=900):
    """Return explicit gates and missing evidence; never a product listing.

    Market, price, provenance and destination must all be independently
    attested before a future production adapter can consider an offer.
    """
    r = _dict(report)
    stages = [_dict(v) for v in r.get("observations", [])
              if isinstance(v, dict)] if isinstance(r.get("observations"), list) else []
    by_step = {v.get("step"): v for v in stages
               if isinstance(v.get("step"), str)}
    source_reached = (
        all(by_step.get(stage, {}).get("httpStatus") == 200
            and by_step.get(stage, {}).get("state") == "HTML_SOURCE_RECEIVED"
            for stage in REQUIRED_STAGES)
    )
    source_market = (r.get("sourceMarket") == "AE" and
                     r.get("pdpLang") in ("en-AE", "ar-AE"))
    sku = r.get("selectedSku")
    offer_identity = (isinstance(sku, str) and
                      bool(SKU.fullmatch(sku)) and
                      r.get("selection", {}).get("state") == "SINGLE_LIVE_OFFER_SELECTED"
                      if isinstance(r.get("selection"), dict) else False)
    ast = _dict(r.get("tanstackTsrAst"))
    cross = _dict(r.get("crossSurfaceCorroboration"))
    delivery = _dict(r.get("saudiDeliveryEvidence"))
    current_price_cents = cents(r.get("plpDisplayedPrice"))
    records = [
        item for item in ast.get("candidateRecords", [])
        if isinstance(item, dict) and
        item.get("sameSku") is True and
        item.get("skuExplicitInOfferRecord") is True and
        item.get("skuAliasesConflict") is False and
        type(item.get("priceCents")) is int
    ] if isinstance(ast.get("candidateRecords"), list) else []
    prices = {item["priceCents"] for item in records}
    same_offer_amount = bool(
        current_price_cents is not None and prices == {current_price_cents}
    )
    currency_per_offer = bool(
        cross.get("sameOfferCurrencyAttested") is True
        and ast.get("exactOfferWithExplicitSkuCurrencyPrice") is True
    )
    country_shippable = bool(
        delivery.get("sourceEvidenceValid") is True and
        delivery.get("countryEligible") is True
    )
    city_shippable = bool(
        country_shippable and delivery.get("cityEligible") is True
    )
    observed = r.get("observedUtc") or r.get("observedUTC")
    fresh = False
    if isinstance(observed, str):
        try:
            when = datetime.fromisoformat(observed.replace("Z", "+00:00"))
            now = now_utc or datetime.now(timezone.utc)
            if when.tzinfo is not None and now.tzinfo is not None:
                delta = (now - when).total_seconds()
                fresh = -60 <= delta <= max_age_s
        except (ValueError, TypeError):
            pass
    gates = {
        "source_http_and_html": source_reached,
        "uae_market_context": source_market,
        "valid_sku_and_offer_selection": offer_identity,
        "source_observation_fresh": fresh,
        "same_offer_amount_verified": same_offer_amount,
        "same_offer_currency_aed_verified": currency_per_offer,
        "saudi_country_delivery_authenticated": country_shippable,
        "saudi_destination_city_verified": city_shippable,
        # A one-run 3-session snapshot does not prove a production uptime SLA.
        "independent_long_window_stability": False,
    }
    missing = [key for key, passed in gates.items() if not passed]
    return {
        "schema": "nawaa.noon-uae.admission-gate.v1",
        "gates": gates,
        "missing": missing,
        "passingCount": sum(gates.values()),
        "requiredCount": len(gates),
        "customerPublishable": False,
        "releaseDecision": (
            "NOT_READY_LONG_WINDOW_AND_ROLLOUT_GATES"
            if not missing else "BLOCKED_EVIDENCE_INCOMPLETE"
        ),
    }
