"""Offline source-identity and HTML admission tests for the Noon UAE worker."""
import unittest
from types import SimpleNamespace
from nawaa_py.noon_ae_search import request_url, attested_result, extract_cards, numeric_price

class NoonUaeTransportContracts(unittest.TestCase):
    def response(self, *, url=None, status=200, content=b"<html lang='en-AE'></html>",
                 content_type="text/html; charset=utf-8"):
        return SimpleNamespace(url=url or request_url("laptop"),
                               status_code=status, content=content,
                               headers={"content-type": content_type})

    def test_query_url_is_exact_and_encoded(self):
        self.assertEqual(request_url("laptop"),
            "https://www.noon.com/uae-en/search/?q=laptop")
        self.assertIn("%D8%B3", request_url("سماعات بلوتوث"))
        for bad in ("", "x", "a\nb", "a\x00b", "x"*121):
            with self.assertRaises(ValueError): request_url(bad)

    def test_same_exact_query_owned_html(self):
        url=request_url("laptop")
        html,final=attested_result(self.response(),url)
        self.assertIn("<html", html)
        self.assertEqual(final,url)

    def test_never_accept_redirect_or_cross_market_page(self):
        url=request_url("laptop")
        for changed in ("https://noon.com/uae-en/search/?q=laptop",
                        "https://www.noon.com/saudi-en/search/?q=laptop",
                        "https://www.noon.com/uae-en/search/?q=phone",
                        "https://attacker.invalid/uae-en/search/?q=laptop",
                        "http://www.noon.com/uae-en/search/?q=laptop"):
            with self.assertRaisesRegex(ValueError,"SOURCE_SEARCH_URL_MISMATCH"):
                attested_result(self.response(url=changed),url)

    def test_http_403_and_429_are_denials_not_empty_catalog(self):
        url=request_url("laptop")
        for status,code in ((403,"HTTP_403_ACCESS_DENIED"),(429,"HTTP_429_RATE_LIMITED")):
            with self.assertRaisesRegex(ValueError,code):
                attested_result(self.response(status=status),url)

    def test_deny_non_html_and_oversize(self):
        url=request_url("laptop")
        with self.assertRaisesRegex(ValueError,"NON_HTML_RESPONSE"):
            attested_result(self.response(content_type="application/json"),url)
        with self.assertRaisesRegex(ValueError,"RESPONSE_TOO_LARGE"):
            attested_result(self.response(content=b"x"*3_000_001),url)

    def test_real_pr310_selector_shape_emits_json_cards(self):
        # Visible card surface mirrors historical live PR #310 selector shape.
        html = """<html lang="en-AE"><body><h1>iPhone 17</h1>
        <a href="/uae-en/iphone-17-256gb-black/N70211553V/p/?o=a46bd3942170c30c">
          <div data-qa="plp-product-box-name">Apple iPhone 17 256GB Black</div>
          <div data-qa="plp-product-box-price"><strong class="amount">3,399</strong></div>
          <picture><source srcset="https://f.nooncdn.com/p/pzsku/test.jpg?width=800 800w"/></picture>
        </a></body></html>"""
        out=extract_cards(html, "iPhone 17")
        self.assertEqual(out["language"], "en-AE")
        self.assertEqual(out["heading"], "iPhone 17")
        self.assertEqual(len(out["cards"]),1)
        card=out["cards"][0]
        self.assertEqual(card["productId"],"N70211553V")
        self.assertEqual(card["offerCode"],"a46bd3942170c30c")
        self.assertEqual(card["priceAED"],3399)
        self.assertEqual(card["priceText"],"3,399")
        self.assertEqual(card["currency"],"AED")
        self.assertIn("?o=a46bd3942170c30c",card["sourceUrl"])

    def test_python_does_not_fabricate_price_from_page_context(self):
        html = """<html lang="en-AE"><body><h1>iPhone 17</h1>
        <a href="/uae-en/iphone-17-256gb-black/N70211553V/p/?o=a46bd3942170c30c">
          <div data-qa="plp-product-box-name">Apple iPhone 17 256GB Black</div>
          <div data-qa="plp-product-box-price"><strong class="amount">SAR 3,399</strong></div>
          <img src="https://f.nooncdn.com/p/item.jpg"/></a></body></html>"""
        self.assertEqual(extract_cards(html,"iPhone 17")["cards"],[])
        with self.assertRaisesRegex(ValueError,"SEARCH_PAGE_CONTEXT_NOT_ATTESTED"):
            extract_cards(html,"PlayStation 5")
        with self.assertRaisesRegex(ValueError,"UAE_MARKET_LOCALE_NOT_ATTESTED"):
            extract_cards(html.replace('en-AE','en-SA'),"iPhone 17")

    def test_amount_parser_accepts_arabic_digits_and_rejects_multiple_prices(self):
        self.assertEqual(numeric_price("٣٬٣٩٩٫٥٠"),3399.5)
        self.assertIsNone(numeric_price("3,399 4,599"))
        self.assertIsNone(numeric_price("USD 3,399"))

if __name__=="__main__":
    unittest.main()
