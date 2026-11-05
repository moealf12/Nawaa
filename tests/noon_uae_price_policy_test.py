"""Pure safety invariants; not a substitute for the LIVE GitHub source gate."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_price_policy import assess_offer, cents, corroborate_sources, aed_to_sar_estimate  # noqa: E402

SKU = "N40633047A"
OFFER = "f24643243856845e"
URL = (
    "https://www.noon.com/uae-en/"
    "playstation-5-console-disc-version-with-controller/"
    + SKU + "/p/?o=" + OFFER
)


def audit(**changes):
    fields = {
        "requested_sku": SKU,
        "product_sku": SKU,
        "plp_price": "2099.00",
        "pdp_price": "2099.00",
        "currency": "AED",
        "requested_offer_code": OFFER,
        "offer_url": URL,
    }
    fields.update(changes)
    return assess_offer(**fields)


class PolicyTests(unittest.TestCase):
    def test_exact_offer_price_and_currency_evidence(self):
        result = audit()
        self.assertTrue(result["verified"])
        self.assertEqual(result["deltaCents"], 0)
        self.assertEqual(result["decision"], "SAME_OFFER_PRICE_AND_CURRENCY_VERIFIED")
        self.assertFalse(result["customerPublishable"])

    def test_real_live_differential_five_cents_is_not_rounded(self):
        result = audit(pdp_price="2099.05", offer_url=None)
        self.assertEqual(result["decision"], "CROSS_SURFACE_AMOUNT_DIFFERS")
        self.assertEqual(result["deltaCents"], 5)
        self.assertFalse(result["verified"])

    def test_unsupported_sku_or_variant_is_rejected(self):
        for sku in ("N00000001A", "", "N40633047X", "N40633047V"):
            self.assertEqual(audit(product_sku=sku)["decision"], "SKU_MISMATCH")

    def test_foreign_currency_never_promoted_to_aed(self):
        for currency in ("SAR", "USD", "", None):
            self.assertEqual(
                audit(currency=currency)["decision"],
                "CURRENCY_NOT_ATTESTED_AS_AED",
            )

    def test_no_offer_code_cannot_be_inferred_from_url(self):
        result = audit(offer_url=None)
        self.assertEqual(result["decision"], "PRICE_MATCHES_BUT_OFFER_IDENTITY_UNKNOWN")
        self.assertFalse(result["verified"])

    def test_noon_url_host_and_market_pinning(self):
        for url in (
            URL.replace("www.noon.com", "www.noon.com.evil.example"),
            URL.replace("/uae-en/", "/saudi-en/"),
            URL.replace("https://", "http://"),
            URL.replace(OFFER, "different-offer"),
            URL.replace(SKU, "N12345678A"),
        ):
            self.assertFalse(audit(offer_url=url)["verified"], url)

    def test_ambiguous_money_fails_closed(self):
        for price in ("2,099.00", "2099.001", "-2099", "0", "1e3",
                      "Infinity", "NaN", None, True, "2099,00"):
            self.assertIsNone(cents(price), price)
            self.assertEqual(
                audit(pdp_price=price)["decision"], "PRICE_MISSING_OR_INVALID"
            )

    def test_simple_aed_to_sar_estimate(self):
        self.assertEqual(aed_to_sar_estimate("1000.00"), "1023.00")
        self.assertEqual(aed_to_sar_estimate("19.99"), "20.45")
        self.assertEqual(aed_to_sar_estimate("0.01"), "0.01")
        for invalid in (None, True, -5, "1e3", "2,099.00", "NaN"):
            self.assertIsNone(aed_to_sar_estimate(invalid))

    def test_cent_precision_exact(self):
        self.assertEqual(cents("2099.05"), 209905)
        self.assertEqual(cents("2099.00"), 209900)
        self.assertEqual(cents("0.01"), 1)
        self.assertEqual(cents("99999999.99"), 9999999999)


    def test_product_level_aed_corrob_is_not_same_offer_currency(self):
        ast = [{"sameSku": True, "skuExplicitInOfferRecord": True,
                "skuAliasesConflict": False, "priceKind": "saleprice",
                "priceCents": 197900, "currency": None}]
        ld = [{"currency": "AED", "price": "1979.00"}]
        v = corroborate_sources(
            plp_price="1979", ast_candidates=ast, jsonld_offers=ld
        )
        self.assertEqual(
            v["state"], "OFFER_PRICE_PRODUCT_AED_CORROBORATED_CURRENCY_NOT_PER_OFFER"
        )
        self.assertTrue(v["productCurrencyCorroborated"])
        self.assertFalse(v["sameOfferCurrencyAttested"])
        self.assertFalse(v["customerPublishable"])

    def test_conflicting_same_offer_prices_never_pass(self):
        ast = [
            {"sameSku": True, "skuExplicitInOfferRecord": True,
             "skuAliasesConflict": False, "priceKind": "saleprice",
             "priceCents": x}
            for x in (197900, 197905)
        ]
        v = corroborate_sources(
            plp_price="1979", ast_candidates=ast,
            jsonld_offers=[{"currency": "AED", "price": "1979"}]
        )
        self.assertEqual(v["state"], "CONFLICTING_OFFER_PRICE_EVIDENCE")
        self.assertFalse(v["customerPublishable"])

    def test_product_level_currency_cannot_override_wrong_offer(self):
        ast = [{"sameSku": False, "skuExplicitInOfferRecord": False,
                "skuAliasesConflict": False, "priceKind": "saleprice",
                "priceCents": 197900, "currency": "AED"}]
        v = corroborate_sources(
            plp_price="1979", ast_candidates=ast,
            jsonld_offers=[{"currency": "AED", "price": "1979"}]
        )
        self.assertEqual(v["state"], "SOURCE_OFFER_PRICE_NOT_MATCHED")



if __name__ == "__main__":
    unittest.main()
