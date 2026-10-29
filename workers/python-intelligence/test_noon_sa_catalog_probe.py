import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from noon_sa_catalog_probe import parse_payload, price_value, product_url

URL="/saudi-ar/apple-iphone-15/N12345678A/p/"
class NoonProbeTests(unittest.TestCase):
    def test_price(self):
        self.assertEqual(price_value("1999.50"),"1999.50")
        self.assertIsNone(price_value("1,999.50"))
        self.assertIsNone(price_value(-1))
        self.assertIsNone(price_value(None))
    def test_urls(self):
        self.assertTrue(product_url(URL).startswith("https://www.noon.com/"))
        self.assertIsNone(product_url("https://evil.example/saudi-ar/a/p/"))
        self.assertIsNone(product_url("/saudi-ar/search?q=x"))
    def test_deduplicate_and_price(self):
        hit={"sku":"N12345678A","name":"Apple iPhone 15 128GB",
             "price":2200,"sale_price":1999.50,"image_key":"p123",
             "url":URL}
        r=parse_payload({"hits":[hit,hit]})
        self.assertEqual(r["status"],"CATALOG_RESULTS")
        self.assertEqual(len(r["items"]),1)
        self.assertEqual(r["items"][0]["price_sar"],"1999.5")
        self.assertFalse(r["items"][0]["customer_publishable"])
        self.assertNotIn("seller",r["items"][0])
        self.assertNotIn("shipping",r["items"][0])
    def test_sale_over_regular_rejected(self):
        h={"sku":"N12345678A","name":"iPhone 15","price":2100,"sale_price":2500,"url":URL}
        self.assertEqual(parse_payload({"hits":[h]})["items"][0]["price_sar"],"2100")
    def test_wrong_payload(self):
        self.assertEqual(parse_payload({"items":[]})["status"],"UNEXPECTED_SCHEMA")
if __name__=="__main__":
    unittest.main()
