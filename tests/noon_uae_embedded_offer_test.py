"""Offline invariants; separate LIVE merchant acquisition remains mandatory."""
import json
import sys
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_embedded_offer import inspect_offer_scripts  # noqa: E402

SKU = "N40633047A"
OFFER = "abc123-for-uae"
PRICE = "2099.00"


def inspect(html):
    return inspect_offer_scripts(
        BeautifulSoup(html, "html.parser"),
        sku=SKU, offer_code=OFFER, plp_price=PRICE
    )


def record(**changes):
    data = {"sku_config": SKU, "offer_code": OFFER, "price": PRICE, "currency": "AED"}
    data.update(changes)
    return data


def script(obj, typ="application/json"):
    return '<script type="' + typ + '">' + json.dumps(obj) + "</script>"


class EmbeddedEvidenceTests(unittest.TestCase):
    def test_exact_offer_same_record(self):
        r = inspect(script(record()))
        self.assertTrue(r["samePriceOfferAttested"])
        self.assertTrue(r["exactOfferWithExplicitSkuCurrencyPrice"])
        self.assertFalse(r["customerPublishable"])

    def test_js_literal_assignment_is_decoded_but_not_executed(self):
        value = json.dumps({"product": {"offers": [record()]}})
        r = inspect('<script>window.__STATE__=' + value + ';</script>')
        self.assertTrue(r["samePriceOfferAttested"])
        self.assertEqual(r["decodedPathCounts"]["js_json_assignment"], 1)

    def test_json_parse_quoted_literal(self):
        inner = json.dumps({"list": [record()]})
        outer = json.dumps(inner)
        r = inspect("<script>window.data=JSON.parse(" + outer + ");</script>")
        self.assertTrue(r["samePriceOfferAttested"])
        self.assertEqual(r["decodedPathCounts"]["json_parse_literal"], 1)

    def test_same_script_lexical_proximity_is_not_identity(self):
        obj = [{"sku": SKU, "price": PRICE, "currency": "AED"},
               {"offer_code": OFFER, "price": PRICE, "currency": "AED"}]
        r = inspect(script(obj))
        self.assertFalse(r["samePriceOfferAttested"])
        self.assertFalse(r["exactOfferWithExplicitSkuCurrencyPrice"])

    def test_wrong_sku_explicit_blocks_product_parent(self):
        nested = {"sku": SKU, "offers": [record(sku_config="N11111111A")]}
        r = inspect(script(nested))
        self.assertFalse(r["samePriceOfferAttested"])

    def test_nested_sku_not_explicit_cannot_grant_verified(self):
        nested = {"sku": SKU, "offers": [{
            "offer_code": OFFER, "price": PRICE, "currency": "AED"
        }]}
        r = inspect(script(nested))
        self.assertFalse(r["samePriceOfferAttested"])
        self.assertFalse(r["exactOfferWithExplicitSkuCurrencyPrice"])

    def test_wrong_currency_does_not_pass(self):
        r = inspect(script(record(currency="SAR")))
        self.assertFalse(r["samePriceOfferAttested"])

    def test_five_fils_exact_difference_not_ignored(self):
        r = inspect(script(record(price="2099.05")))
        self.assertFalse(r["samePriceOfferAttested"])
        self.assertTrue(r["exactOfferWithExplicitSkuCurrencyPrice"])
        self.assertEqual(r["offerCandidateRecords"][0]["deltaCents"], 5)

    def test_missing_currency_does_not_infer_from_locale(self):
        obj = {"locale": "en-AE", "data": record(currency=None)}
        r = inspect(script(obj))
        self.assertFalse(r["samePriceOfferAttested"])

    def test_missing_or_duplicate_price_is_rejected(self):
        for value in (None, "-200", "0", "2099.001", "2,099.00", True):
            with self.subTest(value=value):
                r = inspect(script(record(price=value)))
                self.assertFalse(r["samePriceOfferAttested"])

    def test_structured_nested_price_currency(self):
        item = record(price={"amount": PRICE, "currency": "AED"}, currency=None)
        r = inspect(script(item))
        self.assertTrue(r["samePriceOfferAttested"])

    def test_malicious_js_not_executed(self):
        source = ('<script>fetch("https://evil.example/");'
                  'window.hack=alert("hello");</script>')
        r = inspect(source)
        self.assertFalse(r["samePriceOfferAttested"])
        self.assertEqual(r["jsonObjectsDecoded"], 0)

    def test_only_inlining_same_code_selected(self):
        obj = {"offers": [
            record(offer_code="another-offer"),
            record(offer_code=OFFER, price=PRICE)
        ]}
        r = inspect(script(obj))
        self.assertTrue(r["samePriceOfferAttested"])
        self.assertEqual(len(r["offerCandidateRecords"]), 1)


if __name__ == "__main__":
    unittest.main()
