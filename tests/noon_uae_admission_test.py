"""Admission diagnostics: prove transport success cannot authorize prices."""
import copy
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_admission import evaluate_noon_uae_admission  # noqa: E402

NOW = datetime(2026, 11, 5, 1, 0, tzinfo=timezone.utc)


def live_report():
    return {
        "sourceMarket": "AE",
        "pdpLang": "en-AE",
        "observedUtc": NOW.isoformat(),
        "selectedSku": "N40633048A",
        "selection": {"state": "SINGLE_LIVE_OFFER_SELECTED"},
        "plpDisplayedPrice": "1979",
        "observations": [
            {"step": step, "httpStatus": 200, "state": "HTML_SOURCE_RECEIVED"}
            for step in ("warmup", "plp_live", "one_offer_linked_pdp")
        ],
        "tanstackTsrAst": {
            "samePriceOfferAttested": False,
            "exactOfferWithExplicitSkuCurrencyPrice": False,
            "candidateRecords": [{
                "sameSku": True,
                "skuExplicitInOfferRecord": True,
                "skuAliasesConflict": False,
                "priceKind": "saleprice",
                "priceCents": 197900,
                "currency": None,
            }],
        },
        "crossSurfaceCorroboration": {
            "sameOfferCurrencyAttested": False,
            "productCurrencyCorroborated": True,
        },
        "saudiDeliveryEvidence": {
            "sourceEvidenceValid": False,
            "countryEligible": None,
            "cityEligible": None,
        },
        "customerPublishable": False,
    }


def gate(report, **kw):
    return evaluate_noon_uae_admission(report, now_utc=NOW, **kw)


class AdmissionGateTests(unittest.TestCase):
    def test_actual_evidence_shape_is_blocked_correctly(self):
        r = gate(live_report())
        self.assertTrue(r["gates"]["source_http_and_html"])
        self.assertTrue(r["gates"]["same_offer_amount_verified"])
        self.assertFalse(r["gates"]["same_offer_currency_aed_verified"])
        self.assertFalse(r["gates"]["saudi_country_delivery_authenticated"])
        self.assertFalse(r["gates"]["independent_long_window_stability"])
        self.assertFalse(r["customerPublishable"])
        self.assertEqual(r["releaseDecision"], "BLOCKED_EVIDENCE_INCOMPLETE")

    def test_source_http_403_never_relabels_as_no_inventory(self):
        r = live_report()
        r["observations"][0]["httpStatus"] = 403
        result = gate(r)
        self.assertFalse(result["gates"]["source_http_and_html"])
        self.assertFalse(result["customerPublishable"])

    def test_five_fils_difference_is_a_blocker(self):
        r = live_report()
        r["tanstackTsrAst"]["candidateRecords"][0]["priceCents"] += 5
        self.assertFalse(gate(r)["gates"]["same_offer_amount_verified"])

    def test_conflicting_alias_amounts_fail_closed(self):
        r = live_report()
        second = copy.deepcopy(r["tanstackTsrAst"]["candidateRecords"][0])
        second["priceCents"] = 197905
        r["tanstackTsrAst"]["candidateRecords"].append(second)
        self.assertFalse(gate(r)["gates"]["same_offer_amount_verified"])

    def test_product_aed_only_does_not_make_offer_currency(self):
        r = live_report()
        r["crossSurfaceCorroboration"]["productCurrencyCorroborated"] = True
        self.assertFalse(gate(r)["gates"]["same_offer_currency_aed_verified"])

    def test_signed_country_alone_does_not_prove_city(self):
        r = live_report()
        r["saudiDeliveryEvidence"]["sourceEvidenceValid"] = True
        r["saudiDeliveryEvidence"]["countryEligible"] = True
        result = gate(r)
        self.assertTrue(result["gates"]["saudi_country_delivery_authenticated"])
        self.assertFalse(result["gates"]["saudi_destination_city_verified"])
        self.assertFalse(result["customerPublishable"])

    def test_stale_timestamp_blocks_admission(self):
        r = live_report()
        r["observedUtc"] = (NOW - timedelta(seconds=901)).isoformat()
        self.assertFalse(gate(r)["gates"]["source_observation_fresh"])

    def test_wrong_market_blocks_admission(self):
        r = live_report()
        r["sourceMarket"] = "SA"
        self.assertFalse(gate(r)["gates"]["uae_market_context"])

    def test_invalid_sku_rejected(self):
        r = live_report()
        r["selectedSku"] = "N40633048X"
        self.assertFalse(gate(r)["gates"]["valid_sku_and_offer_selection"])

    def test_missing_data_is_blocked(self):
        self.assertEqual(gate(None)["passingCount"], 0)
        self.assertFalse(gate(None)["customerPublishable"])

    def test_unknown_saudi_delivery_is_optional_for_uae_offers(self):
        r = live_report()
        r["crossSurfaceCorroboration"]["sameOfferCurrencyAttested"] = True
        r["tanstackTsrAst"]["exactOfferWithExplicitSkuCurrencyPrice"] = True
        result = gate(r)
        self.assertEqual(result["requiredCount"], 7)
        self.assertEqual(result["optionalDelivery"]["status"], "NOT_VERIFIED")
        self.assertFalse(result["optionalDelivery"]["affectsReleaseAdmission"])
        self.assertEqual(result["missing"], ["independent_long_window_stability"])
        self.assertNotIn("saudi_country_delivery_authenticated", result["missing"])
        self.assertNotIn("saudi_destination_city_verified", result["missing"])
        self.assertFalse(result["customerPublishable"])

    def test_verified_ineligible_shipping_does_not_block_uae_offer(self):
        r = live_report()
        r["crossSurfaceCorroboration"]["sameOfferCurrencyAttested"] = True
        r["tanstackTsrAst"]["exactOfferWithExplicitSkuCurrencyPrice"] = True
        r["saudiDeliveryEvidence"] = {
            "sourceEvidenceValid": True, "countryEligible": False,
            "cityEligible": False,
        }
        result = gate(r)
        self.assertEqual(result["optionalDelivery"]["status"], "VERIFIED_INELIGIBLE_TO_SA")
        self.assertEqual(result["missing"], ["independent_long_window_stability"])
        self.assertFalse(result["customerPublishable"])

    def test_verified_saudi_eligibility_is_optional_not_release_condition(self):
        r = live_report()
        r["saudiDeliveryEvidence"] = {
            "sourceEvidenceValid": True, "countryEligible": True,
            "cityEligible": True,
        }
        result = gate(r)
        self.assertEqual(result["optionalDelivery"]["status"], "VERIFIED_ELIGIBLE_TO_SA")
        self.assertEqual(result["requiredCount"], 7)
        self.assertFalse(result["optionalDelivery"]["affectsReleaseAdmission"])

    def test_price_currency_and_source_remain_blockers_regardless_of_delivery(self):
        r = live_report()
        r["saudiDeliveryEvidence"] = {
            "sourceEvidenceValid": True, "countryEligible": True,
            "cityEligible": True,
        }
        result = gate(r)
        self.assertIn("same_offer_currency_aed_verified", result["missing"])
        self.assertIn("independent_long_window_stability", result["missing"])
        self.assertFalse(result["customerPublishable"])


if __name__ == "__main__":
    unittest.main()
