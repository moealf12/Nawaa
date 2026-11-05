"""Country-specific eligibility proof tests; do not simulate LIVE inventory."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_delivery_policy import attest_saudi_delivery  # noqa: E402

NOW = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)
SKU = "N40633048A"
CODE = "offer-uae-test-1"


def quote(**changes):
    evidence = {
        "sourceKind": "merchant_offer_delivery_quote",
        "market": "AE",
        "sku": SKU,
        "offerCode": CODE,
        "destinationCountry": "SA",
        "eligible": True,
        "observedUtc": NOW.isoformat(),
    }
    evidence.update(changes)
    return evidence


def evaluate(evidence):
    return attest_saudi_delivery(
        sku=SKU, offer_code=CODE, evidence=evidence, now_utc=NOW
    )


class DeliveryPolicyTests(unittest.TestCase):
    def test_missing_evidence_is_unknown_not_out_of_stock(self):
        result = evaluate(None)
        self.assertEqual(result["state"], "SAUDI_DELIVERY_UNVERIFIED")
        self.assertIsNone(result["countryEligible"])
        self.assertFalse(result["customerPublishable"])

    def test_explicit_country_eligible_is_not_city_eligible(self):
        result = evaluate(quote())
        self.assertEqual(result["state"], "SA_COUNTRY_ELIGIBLE_CITY_NOT_VERIFIED")
        self.assertTrue(result["countryEligible"])
        self.assertIsNone(result["cityEligible"])
        self.assertFalse(result["shippingFeeKnown"])
        self.assertFalse(result["customerPublishable"])

    def test_explicit_not_deliverable_is_distinct_from_unknown(self):
        result = evaluate(quote(eligible=False))
        self.assertEqual(result["state"], "EXPLICIT_NOT_DELIVERABLE_TO_SA")
        self.assertIs(result["countryEligible"], False)

    def test_global_badge_does_not_attest_shipping(self):
        result = evaluate(quote(sourceKind="global_badge"))
        self.assertEqual(result["state"], "NON_AUTHORITATIVE_DELIVERY_HINT")
        self.assertIsNone(result["countryEligible"])

    def test_other_country_is_not_saudi(self):
        result = evaluate(quote(destinationCountry="AE"))
        self.assertEqual(result["state"], "DESTINATION_NOT_ATTESTED_AS_SA")

    def test_invalid_offer_and_sku_rejected(self):
        self.assertEqual(
            evaluate(quote(offerCode="other-code"))["state"],
            "OFFER_IDENTITY_MISMATCH"
        )
        self.assertEqual(
            evaluate(quote(sku="N00000001A"))["state"],
            "OFFER_IDENTITY_MISMATCH"
        )

    def test_future_or_stale_quotes_are_rejected(self):
        for seconds in (-3600, 901, 100000):
            with self.subTest(seconds=seconds):
                time_str = (NOW - timedelta(seconds=seconds)).isoformat()
                state = evaluate(quote(observedUtc=time_str))["state"]
                self.assertEqual(state, "DELIVERY_EVIDENCE_STALE_OR_INVALID")

    def test_authorized_feed_with_country_quote_is_allowed(self):
        result = evaluate(quote(sourceKind="authorized_offer_delivery_feed"))
        self.assertTrue(result["sourceEvidenceValid"])
        self.assertFalse(result["customerPublishable"])

    def test_unknown_boolean_not_guessed(self):
        for value in ("yes", 1, None):
            self.assertEqual(
                evaluate(quote(eligible=value))["state"],
                "DELIVERY_ELIGIBILITY_NOT_EXPLICIT"
            )


if __name__ == "__main__":
    unittest.main()
