"""Explainable, fail-closed source admission diagnostics for the Noon UAE probe.

This module never admits a customer price merely because a fetch/test passed.
The evidence is expected from internal parsers and independently verified
partner signatures. A source HTTP 200 is NOT a release-approval signal.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from noon_uae_price_precision import (
    interpret_price_surfaces, select_source_current_offer_amount,
    corroborate_selected_pdp_offer_amount,
)
from noon_uae_price_policy import cents

SKU = re.compile(r"(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)", re.I)
REQUIRED_STAGES = ("warmup", "plp_live", "one_offer_linked_pdp")


def _dict(value):
    return value if isinstance(value, dict) else {}


def evaluate_noon_uae_admission(report, *, now_utc=None, max_age_s=900):
    """Return explicit gates and missing evidence; never a product listing.

    Source, price and currency evidence remain mandatory. Delivery to Saudi
    Arabia is an optional display attribute, never a release blocker.
    This diagnostic still does not publish offers automatically.
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
    source_current_price = select_source_current_offer_amount(
        ast.get("candidateRecords")
    )
    precision_evidence = interpret_price_surfaces(
        r.get("plpDisplayedPrice"), source_current_price.get("priceCents")
    )
    valid_product_offers = []
    jsonld = _dict(r.get("jsonLd"))
    for item in jsonld.get("matchedSkuOffers", [])[:30]:
        if isinstance(item, dict):
            valid_product_offers.append({
                "priceCents": cents(item.get("price")),
                "currency": item.get("currency"),
            })
    currency_corroboration = corroborate_selected_pdp_offer_amount(
        ast.get("candidateRecords"), valid_product_offers
    )
    # A rounded/abbreviated PLP card cannot attest fractional cents, but
    # an exact offer-code/SKU-matched source amount corroborated by same-SKU
    # Product JSON-LD is independent PDP evidence of the precise price.
    # Keep PLP display precision as separate diagnostic evidence, not a
    # source-of-truth amount or an automatic authorization to publish.
    same_offer_amount = bool(
        precision_evidence["exactEqualityAttested"]
        or currency_corroboration["sourceOfferAmountProductPriceCorroborated"]
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
    # Keep historical gate keys for diagnostic compatibility, but do NOT
    # make Saudi delivery a condition for listing a UAE-store offer.
    optional_gate_names = (
        "saudi_country_delivery_authenticated",
        "saudi_destination_city_verified",
    )
    required_gate_names = tuple(
        key for key in gates if key not in optional_gate_names
    )
    missing = [key for key in required_gate_names if not gates[key]]
    delivery_status = (
        "VERIFIED_ELIGIBLE_TO_SA"
        if country_shippable else
        "VERIFIED_INELIGIBLE_TO_SA"
        if delivery.get("sourceEvidenceValid") is True
        and delivery.get("countryEligible") is False else
        "NOT_VERIFIED"
    )
    return {
        "schema": "nawaa.noon-uae.admission-gate.v2",
        "sourceMarket": "AE",
        "pricePrecisionEvidence": precision_evidence,
        "sourceOfferPriceStatus": source_current_price.get("state"),
        "productScopedCurrencyCorroboration": currency_corroboration,
        "gates": gates,
        "requiredGateNames": list(required_gate_names),
        "optionalGateNames": list(optional_gate_names),
        "optionalDelivery": {
            "status": delivery_status,
            "country": "SA",
            "verifiedCountryEligibility": (
                delivery_status == "VERIFIED_ELIGIBLE_TO_SA"
            ),
            "affectsReleaseAdmission": False,
        },
        "missing": missing,
        "passingCount": sum(gates[key] for key in required_gate_names),
        "requiredCount": len(required_gate_names),
        "customerPublishable": False,
        "releaseDecision": (
            "REVIEW_REQUIRED_NO_AUTOMATIC_PUBLICATION"
            if not missing else "BLOCKED_EVIDENCE_INCOMPLETE"
        ),
    }
