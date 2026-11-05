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


def with_direct_aed_evidence(report):
    """Synthetic cross-representation fixture, NOT merchant LIVE evidence."""
    report["tanstackTsrAst"]["candidateRecords"][0]["currency"] = "AED"
    report["jsonLd"] = {"matchedSkuOffers": [
        {"currency": "AED", "price": "1979.00"}
    ]}
    return report


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
        r = with_direct_aed_evidence(live_report())
        result = gate(r)
        self.assertEqual(result["requiredCount"], 7)
        self.assertEqual(result["optionalDelivery"]["status"], "NOT_VERIFIED")
        self.assertFalse(result["optionalDelivery"]["affectsReleaseAdmission"])
        self.assertEqual(result["missing"], ["independent_long_window_stability"])
        self.assertNotIn("saudi_country_delivery_authenticated", result["missing"])
        self.assertNotIn("saudi_destination_city_verified", result["missing"])
        self.assertFalse(result["customerPublishable"])

    def test_verified_ineligible_shipping_does_not_block_uae_offer(self):
        r = with_direct_aed_evidence(live_report())
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


    def test_actual_list_price_and_sale_price_are_not_competing_current_prices(self):
        report = live_report()
        report["tanstackTsrAst"]["candidateRecords"].append({
            "sameSku": True,
            "skuExplicitInOfferRecord": True,
            "skuAliasesConflict": False,
            "priceKind": "price",
            "priceCents": 399900,
            "currency": None,
        })
        result = gate(report)
        self.assertTrue(result["gates"]["same_offer_amount_verified"])
        self.assertEqual(result["sourceOfferPriceStatus"],
                         "UNIQUE_OFFER_LINKED_SOURCE_AMOUNT_NOT_CURRENCY_ATTESTED")
        self.assertFalse(result["gates"]["same_offer_currency_aed_verified"])

    def test_coarse_plp_numeric_surface_remains_unverified(self):
        report = live_report()
        report["tanstackTsrAst"]["candidateRecords"][0]["priceCents"] = 197905
        result = gate(report)
        self.assertEqual(
            result["pricePrecisionEvidence"]["state"],
            "COARSE_PL_DISPLAY_FRACTIONAL_PDP_UNRESOLVED",
        )
        self.assertEqual(result["pricePrecisionEvidence"]["deltaCents"], 5)
        self.assertFalse(result["gates"]["same_offer_amount_verified"])
        self.assertFalse(result["customerPublishable"])

    def test_different_selected_sale_prices_are_not_accepted(self):
        report = live_report()
        report["tanstackTsrAst"]["candidateRecords"].append({
            "sameSku": True,
            "skuExplicitInOfferRecord": True,
            "skuAliasesConflict": False,
            "priceKind": "saleprice",
            "priceCents": 197905,
            "currency": None,
        })
        result = gate(report)
        self.assertEqual(result["sourceOfferPriceStatus"],
                         "CONFLICTING_CURRENT_SOURCE_AMOUNTS")
        self.assertFalse(result["gates"]["same_offer_amount_verified"])
        self.assertFalse(result["customerPublishable"])



    def test_offer_and_same_sku_product_aed_corrob_is_not_direct_currency(self):
        report = live_report()
        report["jsonLd"] = {"matchedSkuOffers": [{
            "currency": "AED", "price": "1979.00",
        }]}
        result = gate(report)
        evidence = result["productScopedCurrencyCorroboration"]
        self.assertTrue(evidence["sourceOfferAmountProductPriceCorroborated"])
        self.assertEqual(evidence["productCurrencyCorroborated"], "AED")
        self.assertFalse(evidence["offerCurrencyDirectlyVerified"])
        self.assertFalse(result["gates"]["same_offer_currency_aed_verified"])
        self.assertFalse(result["customerPublishable"])

    def test_different_seo_product_amount_does_not_attest_aed_to_offer(self):
        report = live_report()
        report["jsonLd"] = {"matchedSkuOffers": [{
            "currency": "AED", "price": "1979.05",
        }]}
        result = gate(report)
        evidence = result["productScopedCurrencyCorroboration"]
        self.assertEqual(evidence["state"], "PDP_PRODUCT_OFFER_AMOUNT_MISMATCH")
        self.assertFalse(evidence["sourceOfferAmountProductPriceCorroborated"])



    def test_fractional_offer_amount_corrob_is_true_without_fake_plp_precision(self):
        report = live_report()
        report["tanstackTsrAst"]["candidateRecords"][0]["priceCents"] = 197905
        report["jsonLd"] = {"matchedSkuOffers": [
            {"currency": "AED", "price": "1979.05"}
        ]}
        result = gate(report)
        self.assertTrue(result["gates"]["same_offer_amount_verified"])
        self.assertEqual(result["pricePrecisionEvidence"]["deltaCents"], 5)
        self.assertFalse(result["pricePrecisionEvidence"]["exactEqualityAttested"])
        self.assertTrue(
            result["productScopedCurrencyCorroboration"][
                "sourceOfferAmountProductPriceCorroborated"
            ]
        )
        self.assertFalse(result["gates"]["same_offer_currency_aed_verified"])
        self.assertFalse(result["customerPublishable"])

    def test_fractional_offer_amount_without_matching_pdp_product_is_blocked(self):
        report = live_report()
        report["tanstackTsrAst"]["candidateRecords"][0]["priceCents"] = 197905
        report["jsonLd"] = {"matchedSkuOffers": [
            {"currency": "AED", "price": "1979.00"}
        ]}
        result = gate(report)
        self.assertFalse(result["gates"]["same_offer_amount_verified"])

    def test_offer_with_conflicting_pdp_product_currencies_cannot_pass(self):
        report = live_report()
        report["tanstackTsrAst"]["candidateRecords"][0]["priceCents"] = 197905
        report["jsonLd"] = {"matchedSkuOffers": [
            {"currency": "AED", "price": "1979.05"},
            {"currency": "USD", "price": "1979.05"},
        ]}
        result = gate(report)
        self.assertFalse(result["gates"]["same_offer_amount_verified"])
        self.assertFalse(result["customerPublishable"])



    def test_claimed_boolean_cannot_create_direct_currency_evidence(self):
        report = live_report()
        report["crossSurfaceCorroboration"]["sameOfferCurrencyAttested"] = True
        report["tanstackTsrAst"]["exactOfferWithExplicitSkuCurrencyPrice"] = True
        result = gate(report)
        self.assertFalse(result["gates"]["same_offer_currency_aed_verified"])
        self.assertEqual(result["currencyEvidenceTier"], "UNVERIFIED")

    def test_same_price_same_sku_without_direct_aed_is_only_product_corrob(self):
        report = live_report()
        report["jsonLd"] = {"matchedSkuOffers": [
            {"currency": "AED", "price": "1979.00"}
        ]}
        result = gate(report)
        self.assertEqual(result["currencyEvidenceTier"], "PRODUCT_SAME_SKU_EXACT_AMOUNT")
        self.assertFalse(result["gates"]["same_offer_currency_aed_verified"])

    def test_fx_preview_only_after_offer_direct_evidence(self):
        unproven = gate(live_report())["fxDisplayPreview"]
        self.assertIsNone(unproven["convertedSarApprox"])
        self.assertIsNone(unproven["sourcePriceAED"])
        self.assertFalse(unproven["customerPublishable"])

        proven = gate(with_direct_aed_evidence(live_report()))["fxDisplayPreview"]
        self.assertEqual(proven["sourcePriceAED"], "1979.00")
        self.assertEqual(proven["convertedSarApprox"], "2024.52")
        self.assertEqual(proven["currencyEvidence"], "OFFER_DIRECT")
        self.assertFalse(proven["customerPublishable"])

    def test_fx_preview_refuses_stale_wrong_market_conflicts_and_missing_source(self):
        for failure in ("stale", "wrong_market", "wrong_sku", "unavailable", "conflicting_currency"):
            report = with_direct_aed_evidence(live_report())
            if failure == "stale":
                report["observedUtc"] = (NOW - timedelta(seconds=901)).isoformat()
            elif failure == "wrong_market":
                report["sourceMarket"] = "SA"
            elif failure == "wrong_sku":
                report["selectedSku"] = "N40633048X"
            elif failure == "unavailable":
                report["observations"][2]["httpStatus"] = 403
            else:
                report["tanstackTsrAst"]["candidateRecords"][0]["currency"] = "USD"
            self.assertIsNone(gate(report)["fxDisplayPreview"]["convertedSarApprox"], failure)

    def test_exact_source_offer_aed_and_product_price_both_required(self):
        report = with_direct_aed_evidence(live_report())
        result = gate(report)
        self.assertEqual(result["currencyEvidenceTier"], "OFFER_DIRECT")
        self.assertTrue(result["gates"]["same_offer_currency_aed_verified"])
        self.assertFalse(result["customerPublishable"])

    def test_conflicting_source_offer_currency_still_blocks_admission(self):
        report = with_direct_aed_evidence(live_report())
        report["tanstackTsrAst"]["candidateRecords"].append({
            "sameSku": True,
            "skuExplicitInOfferRecord": True,
            "skuAliasesConflict": False,
            "priceKind": "saleprice",
            "priceCents": 197900,
            "currency": "USD",
        })
        result = gate(report)
        self.assertEqual(result["currencyEvidenceTier"], "CONFLICTED")
        self.assertFalse(result["gates"]["same_offer_currency_aed_verified"])
        self.assertFalse(result["customerPublishable"])



if __name__ == "__main__":
    unittest.main()
