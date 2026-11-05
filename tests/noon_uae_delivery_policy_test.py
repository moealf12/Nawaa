"""Delivery provenance boundary: only partner-signed evidence may count.

All fixtures are synthetic cryptographic unit tests; no REAL Noon signed feed
or production key has been supplied. No live eligibility is implied.
"""
from __future__ import annotations

import base64
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_delivery_policy import attest_saudi_delivery  # noqa: E402
from noon_uae_partner_attestation import (  # noqa: E402
    verify_partner_delivery_envelope,
)

NOW = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)
SKU = "N40633048A"
CODE = "offer-uae-test-1"
KEY_ID = "noon-unit-test-only-v1"
_PRIVATE = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))
_PUBLIC = _PRIVATE.public_key().public_bytes(
    encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
)
KEYS = {KEY_ID: _PUBLIC}


def encode(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def quote(**changes):
    evidence = {
        "schema": "nawaa.noon.partner-delivery-quote.v1",
        "sourcePartner": "noon",
        "sourceKind": "authorized_offer_delivery_feed",
        "market": "AE",
        "sku": SKU,
        "offerCode": CODE,
        "destinationCountry": "SA",
        "eligible": True,
        "observedUtc": NOW.isoformat(),
    }
    evidence.update(changes)
    return evidence


def signed(source=None, raw=None):
    if raw is None:
        raw = json.dumps(
            source if source is not None else quote(),
            ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode("utf-8")
    return {
        "keyId": KEY_ID,
        "payloadB64": encode(raw),
        "signatureB64": encode(_PRIVATE.sign(raw)),
    }


def evaluate(evidence, *, trusted_keys=KEYS):
    return attest_saudi_delivery(
        sku=SKU, offer_code=CODE, evidence=evidence, now_utc=NOW,
        trusted_public_keys=trusted_keys,
    )


class DeliveryPolicyTests(unittest.TestCase):
    def test_missing_evidence_is_unknown_not_out_of_stock(self):
        result = evaluate(None)
        self.assertEqual(result["state"], "SAUDI_DELIVERY_UNVERIFIED")
        self.assertIsNone(result["countryEligible"])
        self.assertFalse(result["customerPublishable"])

    def test_unsigned_claim_cannot_impersonate_partner_feed(self):
        result = evaluate(quote())
        self.assertEqual(
            result["state"], "UNSIGNED_OR_UNTRUSTED_DELIVERY_EVIDENCE"
        )
        self.assertFalse(result["sourceEvidenceValid"])
        self.assertIsNone(result["countryEligible"])

    def test_valid_signature_yields_country_only_not_shipping_fee(self):
        result = evaluate(signed())
        self.assertEqual(result["state"], "SA_COUNTRY_ELIGIBLE_CITY_NOT_VERIFIED")
        self.assertTrue(result["countryEligible"])
        self.assertIsNone(result["cityEligible"])
        self.assertFalse(result["shippingFeeKnown"])
        self.assertFalse(result["customerPublishable"])

    def test_signed_explicit_not_deliverable_is_distinct_from_unknown(self):
        result = evaluate(signed(quote(eligible=False)))
        self.assertEqual(result["state"], "EXPLICIT_NOT_DELIVERABLE_TO_SA")
        self.assertIs(result["countryEligible"], False)

    def test_global_badge_cannot_attest_shipping_even_if_signed(self):
        result = evaluate(signed(quote(sourceKind="global_badge")))
        self.assertEqual(
            result["state"], "UNSIGNED_OR_UNTRUSTED_DELIVERY_EVIDENCE"
        )
        self.assertIsNone(result["countryEligible"])

    def test_other_signed_country_not_saudi(self):
        result = evaluate(signed(quote(destinationCountry="AE")))
        self.assertEqual(result["state"], "DESTINATION_NOT_ATTESTED_AS_SA")

    def test_wrong_signed_offer_or_sku_rejected(self):
        self.assertEqual(
            evaluate(signed(quote(offerCode="wrong-code")))["state"],
            "OFFER_IDENTITY_MISMATCH",
        )
        self.assertEqual(
            evaluate(signed(quote(sku="N00000001A")))["state"],
            "OFFER_IDENTITY_MISMATCH",
        )

    def test_signed_stale_future_and_invalid_time_rejected(self):
        for seconds in (-3600, 901, 100000):
            with self.subTest(seconds=seconds):
                time_str = (NOW - timedelta(seconds=seconds)).isoformat()
                self.assertEqual(
                    evaluate(signed(quote(observedUtc=time_str)))["state"],
                    "DELIVERY_EVIDENCE_STALE_OR_INVALID",
                )

    def test_signer_key_must_be_pinned_by_operator(self):
        result = evaluate(signed(), trusted_keys={})
        self.assertEqual(
            result["state"], "UNSIGNED_OR_UNTRUSTED_DELIVERY_EVIDENCE"
        )
        result = evaluate(signed(), trusted_keys=None)
        self.assertIsNone(result["countryEligible"])

    def test_tampered_data_rejected(self):
        original = signed()
        forged = signed(quote(eligible=False))
        forged["signatureB64"] = original["signatureB64"]
        self.assertIsNone(
            verify_partner_delivery_envelope(
                forged, trusted_public_keys=KEYS,
            )
        )

    def test_payload_self_supplied_keys_are_never_trusted(self):
        envelope = signed()
        envelope["publicKey"] = encode(_PUBLIC)
        self.assertEqual(
            evaluate(envelope)["state"],
            "UNSIGNED_OR_UNTRUSTED_DELIVERY_EVIDENCE",
        )

    def test_duplicate_json_key_even_if_signed_is_rejected(self):
        raw = b'{"schema":"nawaa.noon.partner-delivery-quote.v1",' \
              b'"sourcePartner":"noon","sourcePartner":"noon"}'
        self.assertIsNone(
            verify_partner_delivery_envelope(
                signed(raw=raw), trusted_public_keys=KEYS,
            )
        )

    def test_unauthorized_source_identity_invalid_even_signed(self):
        result = evaluate(signed(quote(sourcePartner="unknown")))
        self.assertEqual(
            result["state"], "UNSIGNED_OR_UNTRUSTED_DELIVERY_EVIDENCE"
        )

    def test_bool_not_inferred_from_nonboolean_values(self):
        for value in ("yes", 1, None):
            with self.subTest(value=value):
                self.assertEqual(
                    evaluate(signed(quote(eligible=value)))["state"],
                    "DELIVERY_ELIGIBILITY_NOT_EXPLICIT",
                )

    def test_valid_signed_quote_not_customer_publishable(self):
        result = evaluate(signed())
        self.assertTrue(result["sourceEvidenceValid"])
        self.assertFalse(result["customerPublishable"])


if __name__ == "__main__":
    unittest.main()
