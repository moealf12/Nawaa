"""Merchant-display precision invariants; offline tests are not LIVE source proof."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_price_precision import (  # noqa: E402
    interpret_price_surfaces, select_source_current_offer_amount,
    corroborate_selected_pdp_offer_amount,
)


class PrecisionTests(unittest.TestCase):
    def test_integer_plp_five_fils_does_not_become_exact(self):
        r = interpret_price_surfaces("2,099", 209905)
        self.assertEqual(r["state"], "COARSE_PL_DISPLAY_FRACTIONAL_PDP_UNRESOLVED")
        self.assertEqual(r["displayPrecision"], 0)
        self.assertEqual(r["deltaCents"], 5)
        self.assertFalse(r["exactEqualityAttested"])
        self.assertFalse(r["customerPublishable"])

    def test_identical_integer_plp_and_pdp(self):
        r = interpret_price_surfaces("2,099", 209900)
        self.assertEqual(r["state"], "EXACT_NUMERIC_PRICE_MATCH")
        self.assertTrue(r["exactEqualityAttested"])
        self.assertEqual(r["deltaCents"], 0)

    def test_two_decimal_places_mismatch_requires_mismatch_state(self):
        r = interpret_price_surfaces("2,099.00", 209905)
        self.assertEqual(r["state"], "PRICE_DIFFERENCE_UNRESOLVED")
        self.assertEqual(r["displayPrecision"], 2)
        self.assertFalse(r["exactEqualityAttested"])

    def test_two_decimals_exact_equality(self):
        r = interpret_price_surfaces("59.95", 5995)
        self.assertEqual(r["state"], "EXACT_NUMERIC_PRICE_MATCH")
        self.assertEqual(r["displayPrecision"], 2)

    def test_one_decimal_coarse_fraction(self):
        r = interpret_price_surfaces("59.9", 5995)
        self.assertEqual(r["state"], "COARSE_PL_DISPLAY_FRACTIONAL_PDP_UNRESOLVED")
        self.assertEqual(r["deltaCents"], 5)

    def test_large_discrepancy_not_papered_over_by_integer_plp(self):
        r = interpret_price_surfaces("2,099", 239900)
        self.assertEqual(r["state"], "PRICE_DIFFERENCE_UNRESOLVED")
        self.assertEqual(r["deltaCents"], 30000)

    def test_price_not_interpreted_as_original(self):
        r = interpret_price_surfaces("2,099", 399900)
        self.assertEqual(r["state"], "PRICE_DIFFERENCE_UNRESOLVED")
        self.assertFalse(r["exactEqualityAttested"])

    def test_ambiguous_and_malformed_display_fail_closed(self):
        for raw in ("2.099", "2 099", "2099.005", "2099,05",
                    "0", "-2099", "nan", "AED 2099", "", None, True):
            with self.subTest(raw=raw):
                r = interpret_price_surfaces(raw, 209905)
                if raw == "2.099":
                    # Three decimals is invalid: avoids treating thousands
                    # separator as a decimal.
                    self.assertEqual(r["state"], "INVALID_PRICE_EVIDENCE")
                else:
                    self.assertEqual(r["state"], "INVALID_PRICE_EVIDENCE")

    def test_large_integer_bounds(self):
        r = interpret_price_surfaces("99,999,999.99", 9999999999)
        self.assertEqual(r["state"], "EXACT_NUMERIC_PRICE_MATCH")
        r = interpret_price_surfaces("100,000,000", 10000000000)
        self.assertEqual(r["state"], "INVALID_PRICE_EVIDENCE")

    def test_fractional_pdp_cents_dont_create_phantom_integer(self):
        r = interpret_price_surfaces("59", 5999)
        self.assertEqual(r["state"], "COARSE_PL_DISPLAY_FRACTIONAL_PDP_UNRESOLVED")
        self.assertEqual(r["pdpObservedCents"], 5999)

    def test_currency_and_shipping_not_claimed(self):
        r = interpret_price_surfaces("2,099", 209905)
        self.assertNotIn("currencyVerified", r)
        self.assertNotIn("shippingVerified", r)
        self.assertFalse(r["customerPublishable"])


    def test_offer_sale_price_beats_original_price(self):
        records = [
            {"sameSku": True, "skuExplicitInOfferRecord": True,
             "skuAliasesConflict": False, "priceKind": "price", "priceCents": 399900},
            {"sameSku": True, "skuExplicitInOfferRecord": True,
             "skuAliasesConflict": False, "priceKind": "saleprice", "priceCents": 209905},
        ]
        result = select_source_current_offer_amount(records)
        self.assertEqual(result["priceCents"], 209905)
        self.assertEqual(result["priceKinds"], ["saleprice"])

    def test_two_different_sale_prices_conflict(self):
        records = [
            {"sameSku": True, "skuExplicitInOfferRecord": True,
             "skuAliasesConflict": False, "priceKind": "saleprice", "priceCents": x}
            for x in (209900, 209905)
        ]
        result = select_source_current_offer_amount(records)
        self.assertEqual(result["state"], "CONFLICTING_CURRENT_SOURCE_AMOUNTS")
        self.assertIsNone(result["priceCents"])

    def test_wrong_sku_cannot_be_promoted(self):
        records = [{"sameSku": False, "skuExplicitInOfferRecord": True,
                    "skuAliasesConflict": False, "priceKind": "saleprice",
                    "priceCents": 209905}]
        self.assertIsNone(select_source_current_offer_amount(records)["priceCents"])

    def test_same_current_price_multiple_records_not_conflict(self):
        records = [
            {"sameSku": True, "skuExplicitInOfferRecord": True,
             "skuAliasesConflict": False, "priceKind": "saleprice", "priceCents": 209905},
            {"sameSku": True, "skuExplicitInOfferRecord": True,
             "skuAliasesConflict": False, "priceKind": "currentprice", "priceCents": 209905},
        ]
        self.assertEqual(select_source_current_offer_amount(records)["priceCents"], 209905)

    def test_missing_currency_never_fabricated_by_amount_selector(self):
        record = {"sameSku": True, "skuExplicitInOfferRecord": True,
                  "skuAliasesConflict": False, "priceKind": "saleprice",
                  "priceCents": 209905, "currency": None}
        result = select_source_current_offer_amount([record])
        self.assertEqual(result["priceCents"], 209905)
        self.assertNotIn("currency", result)



    def test_offer_pdp_price_corrob_when_plp_is_whole_only(self):
        records = [{"sameSku": True, "skuExplicitInOfferRecord": True,
                    "skuAliasesConflict": False, "priceKind": "saleprice",
                    "priceCents": 209905}]
        seo = [{"currency": "AED", "priceCents": 209905}]
        result = corroborate_selected_pdp_offer_amount(records, seo)
        self.assertTrue(result["sourceOfferAmountProductPriceCorroborated"])
        self.assertEqual(result["selectedSourceOfferPriceCents"], 209905)
        self.assertEqual(result["productCurrencyCorroborated"], "AED")
        self.assertFalse(result["offerCurrencyDirectlyVerified"])
        self.assertFalse(result["customerPublishable"])

    def test_product_currency_without_same_offer_amount_not_verified(self):
        records = [{"sameSku": False, "skuExplicitInOfferRecord": False,
                    "skuAliasesConflict": False, "priceKind": "price",
                    "priceCents": 209905}]
        seo = [{"currency": "AED", "priceCents": 209905}]
        self.assertFalse(
            corroborate_selected_pdp_offer_amount(
                records, seo
            )["sourceOfferAmountProductPriceCorroborated"]
        )

    def test_pdp_product_not_matching_original_offer_price(self):
        records = [{"sameSku": True, "skuExplicitInOfferRecord": True,
                    "skuAliasesConflict": False, "priceKind": "saleprice",
                    "priceCents": 209905}]
        seo = [{"currency": "AED", "priceCents": 209900}]
        result = corroborate_selected_pdp_offer_amount(records, seo)
        self.assertEqual(result["state"], "PDP_PRODUCT_OFFER_AMOUNT_MISMATCH")

    def test_conflicting_product_currencies_are_rejected(self):
        records = [{"sameSku": True, "skuExplicitInOfferRecord": True,
                    "skuAliasesConflict": False, "priceKind": "price",
                    "priceCents": 339900}]
        seo = [{"currency": "AED", "priceCents": 339900},
               {"currency": "USD", "priceCents": 339900}]
        result = corroborate_selected_pdp_offer_amount(records, seo)
        self.assertEqual(result["state"], "PDP_PRODUCT_OFFERS_CONFLICTING")

    def test_other_product_market_currency_not_misassigned(self):
        records = [{"sameSku": True, "skuExplicitInOfferRecord": True,
                    "skuAliasesConflict": False, "priceKind": "price",
                    "priceCents": 5900}]
        seo = [{"currency": "SAR", "priceCents": 5900}]
        result = corroborate_selected_pdp_offer_amount(records, seo)
        self.assertEqual(result["state"], "PDP_PRODUCT_CURRENCY_NOT_AED")

    def test_missing_product_seo_does_not_infer_currency_from_uae_path(self):
        records = [{"sameSku": True, "skuExplicitInOfferRecord": True,
                    "skuAliasesConflict": False, "priceKind": "price",
                    "priceCents": 5900}]
        self.assertFalse(
            corroborate_selected_pdp_offer_amount(
                records, []
            )["sourceOfferAmountProductPriceCorroborated"]
        )



if __name__ == "__main__":
    unittest.main()
