"""Static AST parser invariants for TanStack streaming SSR, no JavaScript execution."""
import sys
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from noon_uae_tsr_ast import inspect_tsr_ast  # noqa: E402

SKU = "N40633047A"
OFFER = "test-offer-uae-123"


def inspect(source):
    markup = '<script data-tsr-stream-part="">' + source + "</script>"
    return inspect_tsr_ast(BeautifulSoup(markup, "html.parser"),
                           sku=SKU, offer_code=OFFER, plp_price="2099.00")


class TsrAstTests(unittest.TestCase):
    def test_static_object_with_alias_wrappers(self):
        script = (
            'self.$R={tsr:[]};'
            '$_TSR.router=($R=>$R[0]={'
            'products:$R[1]=['
            '$R[2]={sku_config:$R[3]="' + SKU + '",'
            'offer_code:$R[4]="' + OFFER + '",'
            'price:$R[5]="2099.00",currency:$R[6]="AED"}'
            ']})($R= self.$R.tsr);'
        )
        r = inspect(script)
        self.assertTrue(r["offerCodePresentInTsrScript"])
        self.assertGreater(r["astNodesInspected"], 0)
        self.assertTrue(r["samePriceOfferAttested"])
        self.assertFalse(r["customerPublishable"])

    def test_static_alias_reference_from_separate_assignment(self):
        source = (
            'self.$R={tsr:[]};'
            '$R[10]="AED";'
            '$R[11]="2099.00";'
            '$R[12]="' + OFFER + '";'
            '$R[13]="' + SKU + '";'
            '$_TSR.router={sku_config:$R[13],offer_code:$R[12],'
            'price:$R[11],currency:$R[10]};'
        )
        self.assertTrue(inspect(source)["samePriceOfferAttested"])

    def test_script_with_same_fields_in_unrelated_objects_rejected(self):
        source = (
            'self.$R={tsr:[]}; $_TSR.router=['
            '{sku_config:"' + SKU + '",price:"2099.00",currency:"AED"},'
            '{offer_code:"' + OFFER + '",price:"2099.00",currency:"AED"}'
            '];'
        )
        self.assertFalse(inspect(source)["samePriceOfferAttested"])

    def test_mismatched_fils_rejected(self):
        source = (
            'self.$R={}; $_TSR.router={sku_config:"' + SKU + '",'
            'offer_code:"' + OFFER + '",price:"2099.05",currency:"AED"};'
        )
        r = inspect(source)
        self.assertFalse(r["samePriceOfferAttested"])
        self.assertTrue(r["exactOfferWithExplicitSkuCurrencyPrice"])

    def test_currency_missing_rejected(self):
        source = (
            'self.$R={}; $_TSR.router={sku_config:"' + SKU + '",'
            'offer_code:"' + OFFER + '",price:"2099.00"};'
        )
        self.assertFalse(inspect(source)["samePriceOfferAttested"])

    def test_source_js_not_executed(self):
        source = (
            'self.$R={};'
            'fetch("https://evil.example");'
            '$_TSR.router={sku_config:"' + SKU + '",'
            'offer_code:"' + OFFER + '",price:"2099.00",currency:"AED"};'
        )
        self.assertTrue(inspect(source)["samePriceOfferAttested"])


    def test_valid_tsr_script_larger_than_historical_260k_limit(self):
        payload = (
            'self.$R={}; $_TSR.router={sku_config:"' + SKU + '",'
            'offer_code:"' + OFFER + '",sale_price:"2099.00",'
            'currency:"AED"};'
        )
        assert len(payload) < 262580
        payload += " " * (262580 - len(payload))
        result = inspect(payload)
        self.assertEqual(result["maxOfferTsrScriptChars"], 262580)
        self.assertEqual(result["oversizedOfferTsrScriptCount"], 0)
        self.assertGreater(result["astNodesInspected"], 0)
        self.assertTrue(result["samePriceOfferAttested"])

    def test_reject_above_512k_without_executing_or_truncating_js(self):
        source = (
            'self.$R={}; $_TSR.router={sku_config:"' + SKU + '",'
            'offer_code:"' + OFFER + '",price:"2099.00",currency:"AED"};'
        )
        source += " " * (512001 - len(source))
        result = inspect(source)
        self.assertEqual(result["oversizedOfferTsrScriptCount"], 1)
        self.assertEqual(result["maxOfferTsrScriptChars"], 512001)
        self.assertEqual(result["astNodesInspected"], 0)
        self.assertFalse(result["samePriceOfferAttested"])



if __name__ == "__main__":
    unittest.main()
