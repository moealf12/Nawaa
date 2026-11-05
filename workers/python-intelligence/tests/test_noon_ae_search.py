"""Offline source-identity and HTML admission tests for the Noon UAE worker."""
import unittest
from types import SimpleNamespace
from nawaa_py.noon_ae_search import request_url, attested_result

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

if __name__=="__main__":
    unittest.main()
