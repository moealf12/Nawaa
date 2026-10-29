"""Offline fixtures; run python -m unittest discover -s workers/python-intelligence -p 'test_amazon_de_search_probe.py'."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from amazon_de_search_probe import canonical_pdp, parse_eur, parse_search_html

CARD = """<div data-component-type="s-search-result" data-asin="B0ABC12345">
<h2><a href="/Some-Phone/dp/B0ABC12345/ref=sr_1"><span>Smartphone 256 GB</span></a></h2>
<span class="a-price-whole">1.299,</span><span class="a-price-fraction">99</span>
</div>"""

class AmazonDeProbeTests(unittest.TestCase):
    def test_german_prices(self):
        self.assertEqual(parse_eur("1.299,99 €"), "1299.99")
        self.assertEqual(parse_eur("299,00"), "299.00")
        self.assertIsNone(parse_eur("€ 1,299.99"))
        self.assertIsNone(parse_eur(""))
    def test_canonical_merchant_url(self):
        self.assertEqual(canonical_pdp("/foo/dp/B0ABC12345/ref=sr", "B0ABC12345"), "https://www.amazon.de/dp/B0ABC12345")
        self.assertIsNone(canonical_pdp("https://evil.example/dp/B0ABC12345", "B0ABC12345"))
        self.assertIsNone(canonical_pdp("/dp/B0ZZZ99999", "B0ABC12345"))
    def test_structured_card_diagnostic_only(self):
        result = parse_search_html(CARD)
        self.assertEqual(result["status"], "SEARCH_CARDS_FOUND")
        self.assertEqual(len(result["offers"]), 1)
        self.assertEqual(result["offers"][0]["price_eur"], "1299.99")
        self.assertEqual(result["offers"][0]["availability"], "UNKNOWN")
        self.assertFalse(result["offers"][0]["customer_publishable"])
    def test_duplicate_asin(self):
        self.assertEqual(len(parse_search_html(CARD + CARD)["offers"]), 1)
    def test_block_page(self):
        self.assertEqual(parse_search_html("<html>Robot Check captcha</html>")["status"], "CHALLENGE_SUSPECTED")
    def test_missing_title_rejected(self):
        self.assertEqual(parse_search_html('<div data-component-type="s-search-result" data-asin="B0ABC12345"></div>')["offers"], [])

if __name__ == "__main__":
    unittest.main()
