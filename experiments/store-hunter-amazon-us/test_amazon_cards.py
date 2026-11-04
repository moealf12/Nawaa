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
