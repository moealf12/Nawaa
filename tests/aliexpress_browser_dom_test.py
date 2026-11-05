"""Browser DOM evidence contracts; no upstream merchant requests in unit tests."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "aliexpress-browser-dom-live.py"
spec = importlib.util.spec_from_file_location("aliexpress_browser_under_test", SCRIPT)
browser = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = browser
spec.loader.exec_module(browser)

ITEM = "1005012743543835"
URL = "https://ar.aliexpress.com/item/" + ITEM + ".html"


def page(head="", body=""):
    return (
        '<html><head><link rel="canonical" href="' + URL + '">'
        + head + '</head><body><main><h1>Wireless Headphones</h1>'
        + body + '</main></body></html>'
    )


class BrowserDomTests(unittest.TestCase):
    def test_navigation_is_restricted_to_exact_item_and_host(self):
        allow = browser.approved_resource
        args = {"navigation": True, "requested_host": "ar.aliexpress.com", "item_id": ITEM}
        self.assertTrue(allow(URL, **args))
        self.assertTrue(allow(URL + "?locale=ar", **args))
        for url in (
            "https://www.aliexpress.com/item/" + ITEM + ".html",
            "https://www.aliexpress.us/item/3256812557229083.html",
            "https://ar.aliexpress.com/punish?captcha=1",
            "https://ar.aliexpress.com/w/wholesale-headphones.html",
            "https://ar.aliexpress.com.evil.test/item/" + ITEM + ".html",
            "http://ar.aliexpress.com/item/" + ITEM + ".html",
            "https://a:b@ar.aliexpress.com/item/" + ITEM + ".html",
            "https://ar.aliexpress.com:8843/item/" + ITEM + ".html",
        ):
            self.assertFalse(allow(url, **args), url)

    def test_assets_allow_first_party_only_not_lookalikes(self):
        args = {"navigation": False, "requested_host": "ar.aliexpress.com", "item_id": ITEM}
        for url in (
            "https://ae01.alicdn.com/kf/sample.png",
            "https://ae-pic-a1.aliexpress-media.com/kf/sample.png",
            "https://g.alicdn.com/js/app.js",
            "https://ar.aliexpress.com/api/product",
        ):
            self.assertTrue(browser.approved_resource(url, **args), url)
        for url in (
            "http://g.alicdn.com/js/app.js",
            "https://g.alicdn.com.attacker.test/script.js",
            "https://evil.com/pixel",
            "https://ar.aliexpress.com:8443/api/product",
            "file:///etc/passwd",
        ):
            self.assertFalse(browser.approved_resource(url, **args), url)

    def test_rendered_dom_observes_candidate_but_never_publishes(self):
        head = (
            '<meta property="product:price:amount" content="49.50">'
            '<meta property="product:price:currency" content="SAR">'
        )
        result = browser.classify_rendered_dom(page(head), URL, ITEM)
        self.assertEqual(result["state"], "BROWSER_PDP_PRICE_CANDIDATE_NOT_BUYBOX_VERIFIED")
        self.assertEqual(result["dom"]["priceCandidate"]["priceOriginal"], "49.50")
        self.assertEqual(result["dom"]["priceCandidate"]["currency"], "SAR")
        self.assertTrue(result["identityVerified"])
        self.assertFalse(result["customerPublishable"])
        self.assertFalse(result["pdpPriceVerified"])

    def test_challenge_is_not_a_catalog_even_when_http_200(self):
        result = browser.classify_rendered_dom(
            '<html><body>verify you are human</body></html>', URL, ITEM
        )
        self.assertEqual(result["state"], "BROWSER_PDP_CHALLENGE_NOT_CATALOG")
        self.assertIsNone(result["dom"])

    def test_http_denial_and_source_swap_are_nonpublishable(self):
        raw = page(
            '<meta property="product:price:amount" content="49.50">'
            '<meta property="product:price:currency" content="SAR">'
        )
        http = browser.classify_rendered_dom(raw, URL, ITEM, status=403)
        self.assertEqual(http["state"], "BROWSER_PDP_HTTP_UNAVAILABLE")
        swapped = browser.classify_rendered_dom(
            raw, "https://ar.aliexpress.com/item/3256812557229083.html", ITEM
        )
        self.assertEqual(swapped["state"], "BROWSER_PDP_FINAL_ITEM_ID_MISMATCH")
        self.assertFalse(swapped["identityVerified"])
        self.assertIsNone(swapped["dom"])

    def test_ambiguous_variants_do_not_certify_buybox(self):
        head = (
            '<meta property="product:price:amount" content="49.50">'
            '<meta property="product:price:currency" content="SAR">'
        )
        body = (
            '<select name="sku">'
            '<option value="1">Small</option><option value="2">Large</option>'
            '</select>'
        )
        result = browser.classify_rendered_dom(page(head, body), URL, ITEM)
        self.assertEqual(result["state"], "BROWSER_PDP_VARIANT_AMBIGUOUS")
        self.assertFalse(result["pdpPriceVerified"])

    def test_dom_and_jsonld_price_conflicts_block_price(self):
        head = (
            '<meta property="product:price:amount" content="49.50">'
            '<meta property="product:price:currency" content="SAR">'
            '<script type="application/ld+json">'
            '{"@type":"Product","url":"' + URL + '","sku":"' + ITEM + '",'
            '"offers":{"@type":"Offer","price":"99.90","priceCurrency":"SAR"}}'
            '</script>'
        )
        result = browser.classify_rendered_dom(page(head), URL, ITEM)
        self.assertEqual(result["state"], "BROWSER_PDP_DOM_JSONLD_PRICE_CONFLICT")
        self.assertFalse(result["customerPublishable"])

    def test_robots_failure_prevents_browser_launch(self):
        async def fail_if_launched(*args):
            raise AssertionError("Chromium must not launch on robots failure")

        with patch.object(browser.pdp, "verify_public_robots", return_value=(
            False, {"state": "DISALLOWED", "host": "ar.aliexpress.com"}
        )), patch.object(browser, "inspect_browser", side_effect=fail_if_launched):
            report = browser.asyncio.run(browser.collect(ITEM))
        self.assertEqual(report["conclusion"], "BROWSER_PDP_ROBOTS_NOT_VERIFIED")
        self.assertIsNone(report["rendering"])
        self.assertFalse(report["customerPublishable"])

    def test_url_query_price_never_becomes_real_offer(self):
        raw = page() + "?pdp_npi=6%40dis%21SAR%2157.97%216.29"
        result = browser.classify_rendered_dom(raw, URL + "?pdp_npi=6", ITEM)
        self.assertEqual(result["state"], "BROWSER_PDP_PRICE_NOT_ATTESTED")
        self.assertIsNone(result["dom"]["priceCandidate"])


if __name__ == "__main__":
    unittest.main()
