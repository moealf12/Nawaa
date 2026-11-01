import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from noon_sa_snapshot_inspector import inspect_snapshot
from noon_sa_known_urls_probe import URLS, SKU

class NoonSavedHtmlInspectionTests(unittest.TestCase):
    def inspect(self, html, kind):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"noon.html"
            f.write_text(html,encoding="utf-8")
            return inspect_snapshot(f,kind)

    def test_search_next_data_snapshot(self):
        record={"sku":"N12345678A","name":"Laptop 16GB",
                "price":2200,"sale_price":2000,
                "url":"/saudi-ar/laptop-16gb/N12345678A/p/"}
        html='<script id="__NEXT_DATA__" type="application/json">'+json.dumps({
            "props":{"pageProps":{"searchData":{"hits":[record]}}}})+'</script>'
        report=self.inspect(html,"search")
        self.assertEqual(report["parser_status"],"PAGE_SEARCH_DATA")
        self.assertEqual(report["items"],1)
        self.assertEqual(report["advertised_priced_items"],1)
        self.assertFalse(report["customer_publishable"])

    def test_pdp_exact_sku_snapshot(self):
        url=URLS[-1][1]
        html='<script type="application/ld+json">'+json.dumps({
            "@type":"Product","sku":SKU,"url":url,
            "offers":{"@type":"Offer","price":"2299.00",
                      "priceCurrency":"SAR","url":url}})+'</script>'
        report=self.inspect(html,"pdp")
        self.assertEqual(report["unique_source_price_sar"],"2299.00")
        self.assertEqual(report["exact_sku_declared_offers"],1)

    def test_pdp_other_sku_must_not_be_assigned_price(self):
        url=URLS[-1][1]
        html='<script type="application/ld+json">'+json.dumps({
            "@type":"Product","sku":"N70211519V","url":url,
            "offers":{"@type":"Offer","price":"2999",
                      "priceCurrency":"SAR","url":url}})+'</script>'
        self.assertIsNone(self.inspect(html,"pdp")["unique_source_price_sar"])

    def test_html_200_without_data_is_not_product_evidence(self):
        report=self.inspect("<html><body>Noon</body></html>","search")
        self.assertEqual(report["items"],0)
        self.assertEqual(report["parser_status"],"HTML_200_NO_CATALOG_MARKERS")

    def test_oversize_snapshot_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=Path(tmp)/"large.html"
            with f.open("wb") as out:
                out.truncate(8_000_001)
            report=inspect_snapshot(f,"pdp")
            self.assertEqual(report["status"],"SNAPSHOT_SIZE_INVALID")

if __name__=="__main__":
    unittest.main()
