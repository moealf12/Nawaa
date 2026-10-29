import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from noon_sa_known_urls_probe import LONG_SLUG, SKU, PDP_PATH, URLS, matching_pdp_identity, exact_sku_pdp_jsonld

def pdp_html(sku=SKU,offer_url=None):
    p=URLS[-1][1]
    record={"@type":"Product","sku":sku,"url":p,
        "offers":{"@type":"Offer","priceCurrency":"SAR","price":"2299.00",
                  "url":offer_url or p}}
    return '<script type="application/ld+json">'+json.dumps(record)+'</script>'

class KnownNoonLinksTest(unittest.TestCase):
    def test_supplied_long_slug_and_sku(self):
        self.assertEqual(len(LONG_SLUG),219)
        self.assertEqual(SKU,"N70312362V")
        self.assertEqual(URLS[1][1],"https://www.noon.com/saudi-en/search/?q=laptop")
        self.assertEqual(URLS[2][1].split("?")[0],"https://www.noon.com"+PDP_PATH)
        self.assertTrue(matching_pdp_identity(URLS[2][1]))
    def test_off_domain_and_other_sku_are_rejected(self):
        self.assertFalse(matching_pdp_identity(URLS[-1][1].replace("www.noon.com","evil.example")))
        self.assertFalse(matching_pdp_identity(URLS[-1][1].replace(SKU,"N70211519V")))
        self.assertFalse(matching_pdp_identity(URLS[-1][1].replace("saudi-en","uae-en")))
    def test_exact_sku_offer_jsonld_fixture_only(self):
        result=exact_sku_pdp_jsonld(pdp_html())
        self.assertEqual(result["exact_sku_declared_offers"],1)
        self.assertEqual(result["unique_source_price_sar"],"2299.00")
        bad=exact_sku_pdp_jsonld(pdp_html(offer_url=URLS[-1][1].replace(SKU,"N70211519V")))
        self.assertIsNone(bad["unique_source_price_sar"])
        self.assertIsNone(exact_sku_pdp_jsonld(pdp_html(sku="N70211519V"))["unique_source_price_sar"])
    def test_multiple_offers_cannot_confidently_publish_price(self):
        self.assertIsNone(exact_sku_pdp_jsonld(pdp_html()+pdp_html())["unique_source_price_sar"])

if __name__=="__main__":
    unittest.main()
