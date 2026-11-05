"""Fail-closed cross-border fulfillment evidence for Noon UAE source offers.

The UAE product page/Global label does not prove Saudi shipping eligibility.
Only an actual authorized per-offer quote (or explicit per-offer feed evidence)
with selected destination-country and unambiguous eligibility qualifies.
No checkout requests or third-party account actions are performed.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

SKU = re.compile(r"(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)", re.I)
OFFER = re.compile(r"[A-Za-z0-9-]{1,100}")


def _fresh_timestamp(source_time, now_utc, ttl_seconds):
    if not isinstance(source_time, str) or len(source_time) > 45:
        return False
    try:
        value = datetime.fromisoformat(source_time.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    if value.tzinfo is None or now_utc.tzinfo is None:
        return False
    seconds = (now_utc - value).total_seconds()
    return -60 <= seconds <= ttl_seconds


def attest_saudi_delivery(*, sku, offer_code, evidence=None, now_utc=None):
    """Proof of *country eligibility* only, never actual regional checkout price.

    Do not accept country/locale/global badge as a delivery quote. Keep 'false'
    and 'unknown' separate to avoid misrepresenting an access denial as OOS.
    """
    result = {
        "state": "SAUDI_DELIVERY_UNVERIFIED",
        "sourceEvidenceValid": False,
        "countryEligible": None,
        "cityEligible": None,
        "shippingFeeKnown": False,
        "customerPublishable": False,
    }
    if not isinstance(evidence, dict):
        return result
    if not SKU.fullmatch(str(sku or "")) or not OFFER.fullmatch(str(offer_code or "")):
        result["state"] = "IDENTITY_INVALID"
        return result
    if evidence.get("market") != "AE":
        result["state"] = "WRONG_SOURCE_MARKET"
        return result
    if (str(evidence.get("sku") or "").upper() != str(sku).upper()
            or evidence.get("offerCode") != offer_code):
        result["state"] = "OFFER_IDENTITY_MISMATCH"
        return result
    if evidence.get("sourceKind") not in (
        "merchant_offer_delivery_quote", "authorized_offer_delivery_feed",
    ):
        result["state"] = "NON_AUTHORITATIVE_DELIVERY_HINT"
        return result
    # Product snippets saying "Ships to KSA" are hints, not a selected
    # destination country and city from a merchant's offer quote.
    if evidence.get("destinationCountry") != "SA":
        result["state"] = "DESTINATION_NOT_ATTESTED_AS_SA"
        return result
    if not isinstance(evidence.get("eligible"), bool):
        result["state"] = "DELIVERY_ELIGIBILITY_NOT_EXPLICIT"
        return result
    now = now_utc or datetime.now(timezone.utc)
    if not _fresh_timestamp(evidence.get("observedUtc"), now, 900):
        result["state"] = "DELIVERY_EVIDENCE_STALE_OR_INVALID"
        return result
    result["sourceEvidenceValid"] = True
    result["countryEligible"] = evidence["eligible"]
    result["state"] = (
        "SA_COUNTRY_ELIGIBLE_CITY_NOT_VERIFIED"
        if evidence["eligible"]
        else "EXPLICIT_NOT_DELIVERABLE_TO_SA"
    )
    # No per-city or current charge attestation exists at the country scope.
    return result
