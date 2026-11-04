import unittest
from nawaa_store_hunter import parse_html_cards

class AmazonCardsTests(unittest.TestCase):
    def test_current_price_image_asin_identity(self):
        html = """<div data-component-type="s-search-result" data-asin="B0C3HCD34R">
        <a href="/unrelated/dp/B012345678">Sponsored</a>
        <h2><a href="/soundcore/dp/B0C3HCD34R/ref=sr_1_2"><span>soundcore by Anker Q20i Black</span></a></h2>
        <img class="s-image" src="https://m.media-amazon.com/images/I/abc.jpg" alt="soundcore">
        <span class="a-price a-text-price"><span class="a-offscreen">$99.99</span></span>
        <span class="a-price"><span class="a-offscreen">$79.95</span></span>
        <a href="/a/dp/B0C3HCD34R">See options</a></div>"""
        products = parse_html_cards(html, "https://www.amazon.com/s?k=wireless", "https://www.amazon.com", 10)
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0].price, "79.95")
        self.assertEqual(products[0].currency, "USD")
        self.assertEqual(products[0].sku, "B0C3HCD34R")
        self.assertEqual(products[0].url, "https://www.amazon.com/dp/B0C3HCD34R")
        self.assertTrue(products[0].image.endswith("abc.jpg"))

    def test_do_not_guess_currency(self):
        html = """<div data-component-type="s-search-result" data-asin="B0C3HCD34R">
        <a href="/dp/B0C3HCD34R"><h2>Headphones example</h2></a>
        <span class="a-price"><span class="a-offscreen">£40.00</span></span></div>"""
        product = parse_html_cards(html, "https://www.amazon.com/s?k=wireless", "https://www.amazon.com", 10)[0]
        self.assertIsNone(product.price)
        self.assertIsNone(product.currency)

    def test_wrong_asin_not_misassociated(self):
        html = """<div data-component-type="s-search-result" data-asin="B0C3HCD34R">
        <a href="/dp/AAAAAAAAAA"><h2>Wrong product</h2></a>
        <span class="a-price"><span class="a-offscreen">$1</span></span></div>"""
        self.assertEqual(parse_html_cards(html, "https://www.amazon.com/s?k=wireless", "https://www.amazon.com", 10), [])

if __name__ == "__main__":
    unittest.main()


class Amazon503RetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_once_on_transient_503(self):
        import httpx
        from unittest.mock import patch
        import nawaa_store_hunter as m
        calls = []
        def handler(req):
            calls.append(str(req.url))
            return httpx.Response(503 if len(calls) == 1 else 200, text="<html>ok</html>")
        s = m.Scraper("https://www.amazon.com", "phone", 3, 1, "never")
        await s._client.aclose()
        s._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)
        with patch.object(m, "ensure_public_url", side_effect=lambda url, origin=None: url), patch.object(s, "permitted", return_value=True), patch.object(m.asyncio, "sleep") as sleeper:
            body = await s.fetch("search-html", "https://www.amazon.com/s", {"k": "phone"})
        await s.close()
        self.assertEqual(body, "<html>ok</html>")
        self.assertEqual(len(calls), 2)
        sleeper.assert_called_once()


class AmazonAdversarialCardTests(unittest.TestCase):
    def _parse(self, html):
        return parse_html_cards(html, "https://www.amazon.com/s?k=wireless", "https://www.amazon.com", 8)

    def test_no_data_asin_uses_strict_single_asin_parent(self):
        html = """<div class="unlabeled-result"><h2><a href="/x/dp/B0C3HCD34R/ref=a">Headphones by Anker Q20i Black</a></h2>
        <span class="a-price"><span class="a-offscreen">$62.40</span></span>
        <img class="s-image" src="https://m.media-amazon.com/images/I/imgA.jpg" /></div>"""
        products = self._parse(html)
        self.assertEqual(len(products), 1)
        self.assertEqual(products[0].price, "62.40")
        self.assertEqual(products[0].sku, "B0C3HCD34R")

    def test_do_not_mix_sibling_products_without_boundaries(self):
        html = """<div><h2><a href="/dp/B0C3HCD34R">First headphone black edition</a></h2>
          <h2><a href="/dp/B0CZPLV566">Second headphone white edition</a></h2>
          <img class="s-image" src="https://m.media-amazon.com/images/I/sample.jpg" />
          <span class="a-price"><span class="a-offscreen">$30.00</span></span></div>"""
        products = self._parse(html)
        self.assertEqual(len(products), 2)
        self.assertEqual({p.sku for p in products}, {"B0C3HCD34R", "B0CZPLV566"})
        self.assertTrue(all(p.price is None and p.image is None for p in products))

    def test_multiple_current_prices_are_ambiguous(self):
        html = """<div data-component-type="s-search-result" data-asin="B0C3HCD34R">
        <h2><a href="/dp/B0C3HCD34R">Headphones by Anker Q20i Black</a></h2>
        <img class="s-image" src="https://m.media-amazon.com/images/I/sample.jpg" />
        <span class="a-price"><span class="a-offscreen">$30.00</span></span>
        <span class="a-price"><span class="a-offscreen">$35.00</span></span></div>"""
        product = self._parse(html)[0]
        self.assertIsNone(product.price)
        self.assertIn("AMAZON_MULTIPLE_CURRENT_PRICES", product.issues)

    def test_placeholder_is_not_product_image(self):
        html = """<div data-component-type="s-search-result" data-asin="B0C3HCD34R">
        <h2><a href="/dp/B0C3HCD34R">Headphones by Anker Q20i Black</a></h2>
        <img class="s-image" src="https://m.media-amazon.com/images/G/01/x-locale/placeholder.gif" />
        <span class="a-price"><span class="a-offscreen">$59.00</span></span></div>"""
        product = self._parse(html)[0]
        self.assertIsNone(product.image)
        self.assertIn("AMAZON_PRODUCT_IMAGE_MISSING", product.issues)


class AmazonPdpTests(unittest.TestCase):
    def _html(self, price="$79.95", asin="B0C3HCD34R", image=True):
        im = '<img id="landingImage" src="https://m.media-amazon.com/images/I/pdp.jpg" />' if image else ""
        return f'''<link rel="canonical" href="https://www.amazon.com/dp/{asin}" />
        <input id="ASIN" value="{asin}" /><span id="productTitle">Soundcore Q20i Wireless Bluetooth Black Headphones</span>
        <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">{price}</span></span></div>
        <section id="sponsored"><span class="a-price"><span class="a-offscreen">$2.10</span></span></section>{im}'''

    def test_main_buybox_not_related_price(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        result = parse_amazon_us_pdp(self._html(), "https://www.amazon.com/dp/B0C3HCD34R")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].price, "79.95")
        self.assertEqual(result[0].sku, "B0C3HCD34R")
        self.assertTrue(result[0].image.endswith("/pdp.jpg"))

    def test_selected_variant_mismatch_blocks_parity(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        self.assertEqual(parse_amazon_us_pdp(self._html(asin="B0CZPLV566"), "https://www.amazon.com/dp/B0C3HCD34R"), [])

    def test_buybox_conflict_does_not_publish_price(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        html = self._html().replace('<span class="a-price"><span class="a-offscreen">$79.95</span></span>',
            '<span class="a-price"><span class="a-offscreen">$79.95</span></span><span class="a-price"><span class="a-offscreen">$81.99</span></span>')
        p = parse_amazon_us_pdp(html, "https://www.amazon.com/dp/B0C3HCD34R")[0]
        self.assertIsNone(p.price)
        self.assertIn("AMAZON_PDP_MULTIPLE_BUYBOX_PRICES", p.issues)

    def test_no_page_identity_proof_no_price(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        html = '<span id="productTitle">Soundcore Q20i Wireless Bluetooth Black Headphones</span><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$5.99</span></span></div>'
        self.assertEqual(parse_amazon_us_pdp(html, "https://www.amazon.com/dp/B0C3HCD34R"), [])
