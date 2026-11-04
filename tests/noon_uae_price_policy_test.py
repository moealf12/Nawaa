"""Pure safety invariants; not a substitute for the LIVE GitHub source gate."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_price_policy import assess_offer, cents  # noqa: E402

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

    def test_cent_precision_exact(self):
        self.assertEqual(cents("2099.05"), 209905)
        self.assertEqual(cents("2099.00"), 209900)
        self.assertEqual(cents("0.01"), 1)
        self.assertEqual(cents("99999999.99"), 9999999999)


if __name__ == "__main__":
    unittest.main()
