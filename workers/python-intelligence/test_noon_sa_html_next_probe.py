"""Offline tests for Noon HTML-backed catalog discovery."""
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from noon_sa_html_next_probe import parse_html, locate_hits

HIT = {
    "sku": "N12345678A",
    "name": "Apple iPhone 15 128GB",
    "price": 2500,
    "sale_price": 2299.50,
    "url": "/saudi-ar/apple-iphone-15/N12345678A/p/",
    "image_key": "testImage123",
}

def html(data):
    return '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps(data) + '</script></html>'

class NoonHtmlNextTests(unittest.TestCase):
    def test_initial_state_catalog(self):
        response=parse_html(html({"props":{"pageProps":{"initialState":{"catalog":{"hits":[HIT]}}}}}))
        self.assertEqual(response["status"], "INITIAL_STATE_CATALOG")
        self.assertEqual(response["raw_hits"], 1)
        self.assertEqual(response["items"][0]["price_sar"], "2299.5")
        self.assertFalse(response["items"][0]["customer_publishable"])
    def test_search_data_fallback(self):
        response=parse_html(html({"props":{"pageProps":{"searchData":{"hits":[HIT]}}}}))
        self.assertEqual(response["status"], "PAGE_SEARCH_DATA")
        self.assertEqual(len(response["items"]), 1)
    def test_absent_next_data(self):
        self.assertEqual(parse_html("<html><body>Noon</body></html>")["status"],"HTML_200_NO_CATALOG_MARKERS")
    def test_flight_without_next_data_is_not_an_offer(self):
        result=parse_html('<html><script>self.__next_f.push([1,"payload"])</script></html>')
        self.assertEqual(result["status"], "HTML_200_NEXT_FLIGHT_WITHOUT_NEXT_DATA")
        self.assertEqual(result["items"], [])
    def test_jsonld_marker_does_not_create_search_offers(self):
        result=parse_html('<html><script type="application/ld+json">{"@type":"ItemList"}</script></html>')
        self.assertEqual(result["status"], "HTML_200_JSONLD_WITHOUT_NEXT_DATA")
        self.assertEqual(result["items"], [])
    def test_product_dom_without_schema(self):
        result=parse_html('<html><div data-testid="product-card"></div></html>')
        self.assertEqual(result["status"], "HTML_200_PRODUCT_DOM_WITHOUT_NEXT_DATA")
        self.assertEqual(result["items"], [])
    def test_js_shell_without_search_products(self):
        result=parse_html('<html><script src="/_next/static/chunk.js"></script></html>')
        self.assertEqual(result["status"], "HTML_200_JS_SHELL_WITHOUT_NEXT_DATA")
        self.assertEqual(result["items"], [])
    def test_http_200_challenge_is_diagnostic(self):
        result=parse_html('<html><title>Access Denied</title><script>self.__next_f.push(1)</script></html>')
        self.assertEqual(result["status"], "HTML_200_CHALLENGE_PAGE")
        self.assertEqual(result["items"], [])
    def test_invalid_json(self):
        self.assertEqual(parse_html('<script id="__NEXT_DATA__">invalid</script>')["status"], "NEXT_DATA_INVALID_JSON")
    def test_shape_drift(self):
        self.assertEqual(parse_html(html({"props":{"pageProps":{"someOtherData":[]}}}))["status"],"HITS_SCHEMA_NOT_FOUND")
    def test_unknown_offer_is_not_invented(self):
        response=parse_html(html({"props":{"pageProps":{"searchData":{"hits":[{"sku":"N12345678A","name":"no url","price":100}]}}}}))
        self.assertEqual(response["status"],"HITS_PRESENT_NO_USABLE_OFFERS")
        self.assertEqual(response["items"], [])

if __name__=="__main__":
    unittest.main()
