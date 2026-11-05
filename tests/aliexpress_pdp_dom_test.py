"""Deterministic DOM regression evidence for AliExpress PDP, not market mock data."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
DOM_SPEC = importlib.util.spec_from_file_location(
    "aliexpress_dom_under_test", SCRIPTS / "aliexpress-pdp-dom.py"
)
dom = importlib.util.module_from_spec(DOM_SPEC)
sys.modules[DOM_SPEC.name] = dom
DOM_SPEC.loader.exec_module(dom)

PDP_SPEC = importlib.util.spec_from_file_location(
    "aliexpress_pdp_dom_integration", SCRIPTS / "aliexpress-pdp-evidence-live.py"
)
pdp = importlib.util.module_from_spec(PDP_SPEC)
sys.modules[PDP_SPEC.name] = pdp
PDP_SPEC.loader.exec_module(pdp)

ITEM = "1005012743543835"
URL = "https://ar.aliexpress.com/item/" + ITEM + ".html"


def page(*, title="Wireless Headphones", canonical=URL,
         price="69.90", currency="SAR", additional="",
         og_url=None, extra_head=""):
    return (
        "<html><head>"
        '<link rel="canonical" href="' + canonical + '">'
        + ('<meta property="og:url" content="' + og_url + '">' if og_url else "")
        + ('<meta property="product:price:amount" content="' + price + '">'
           if price is not None else "")
        + ('<meta property="product:price:currency" content="' + currency + '">'
           if currency is not None else "")
        + extra_head + "</head><body><main><h1>" + title + "</h1>"
        + additional + "</main></body></html>"
    )


class DomPriceContractTests(unittest.TestCase):
    def test_actual_canonical_and_head_dom_amount_and_currency(self):
        evidence = dom.read_pdp_dom_evidence(page(), ITEM, URL)
        self.assertEqual(evidence["identityState"], "SAME_ITEM_CANONICAL_ATTESTED")
        self.assertEqual(evidence["priceCandidate"]["priceOriginal"], "69.90")
        self.assertEqual(evidence["priceCandidate"]["currency"], "SAR")
        self.assertEqual(evidence["titleCandidate"], "Wireless Headphones")
        self.assertEqual(evidence["state"], "DOM_PRICE_CANDIDATE_NOT_BUYBOX_VERIFIED")
        self.assertFalse(evidence["customerPublishable"])
        self.assertFalse(evidence["pdpPriceVerified"])

    def test_meta_only_page_with_no_canonical_is_not_a_product(self):
        raw = page().replace('<link rel="canonical" href="' + URL + '">', "")
        evidence = dom.read_pdp_dom_evidence(raw, ITEM, URL)
        self.assertEqual(evidence["state"], "DOM_PAGE_ID_NOT_ATTESTED")
        self.assertIsNone(evidence["priceCandidate"])

    def test_official_different_item_or_host_spoof_blocks_pricing(self):
        other = "3256812557229083"
        for candidate in (
            "https://ar.aliexpress.com/item/" + other + ".html",
            "https://ar.aliexpress.com.evil.test/item/" + ITEM + ".html",
            "http://ar.aliexpress.com/item/" + ITEM + ".html",
            "/w/wholesale-headphones.html",
        ):
            evidence = dom.read_pdp_dom_evidence(
                page(canonical=candidate), ITEM, URL
            )
            self.assertEqual(
                evidence["state"], "DOM_CANONICAL_ID_CONFLICT", candidate
            )
            self.assertIsNone(evidence["priceCandidate"])

    def test_conflicted_canonical_and_opengraph_are_not_attested(self):
        other = "https://www.aliexpress.us/item/3256812557229083.html"
        evidence = dom.read_pdp_dom_evidence(
            page(og_url=other), ITEM, URL
        )
        self.assertEqual(evidence["state"], "DOM_CANONICAL_ID_CONFLICT")

    def test_without_explicit_currency_or_valid_price_no_pdp_price(self):
        for arguments in (
            {"currency": None}, {"currency": "usd"}, {"currency": "US D"},
            {"price": None}, {"price": "-10"}, {"price": "0"},
            {"price": "1e2"}, {"price": "69.9999"}, {"price": "9,000"},
        ):
            evidence = dom.read_pdp_dom_evidence(
                page(**arguments), ITEM, URL
            )
            self.assertEqual(
                evidence["state"],
                "DOM_CURRENT_PRICE_WITH_EXPLICIT_CURRENCY_MISSING", arguments
            )
            self.assertIsNone(evidence["priceCandidate"])

    def test_head_and_microdata_disagreement_quarantines_price(self):
        block = (
            '<section itemscope itemtype="https://schema.org/Product">'
            '<meta itemprop="price" content="39.90">'
            '<meta itemprop="priceCurrency" content="SAR">'
            '</section>'
        )
        evidence = dom.read_pdp_dom_evidence(
            page(additional=block), ITEM, URL
        )
        self.assertEqual(evidence["state"], "DOM_PRICE_EVIDENCE_CONFLICT")
        self.assertIsNone(evidence["priceCandidate"])

    def test_microdata_can_be_observed_without_head_price(self):
        block = (
            '<section itemscope itemtype="https://schema.org/Product">'
            '<meta itemprop="price" content="39.90">'
            '<meta itemprop="priceCurrency" content="SAR">'
            '</section>'
        )
        evidence = dom.read_pdp_dom_evidence(
            page(price=None, currency=None, additional=block), ITEM, URL
        )
        self.assertEqual(evidence["priceCandidate"]["priceOriginal"], "39.90")
        self.assertIn("DOM_PRODUCT_MICRODATA", evidence["priceMethods"])

    def test_data_attributes_must_identify_same_product_and_currency(self):
        attrs = (
            '<div data-product-id="' + ITEM
            + '" data-price-current="39.90" data-currency="USD" '
            + 'data-selected-sku="120000001"></div>'
        )
        evidence = dom.read_pdp_dom_evidence(
            page(price=None, currency=None, additional=attrs), ITEM, URL
        )
        self.assertEqual(evidence["priceCandidate"]["currency"], "USD")
        self.assertIn("DOM_EXACT_ITEM_DATA_ATTRIBUTES", evidence["priceMethods"])
        self.assertEqual(evidence["state"], "DOM_PRICE_CANDIDATE_NOT_BUYBOX_VERIFIED")
        wrong = attrs.replace(ITEM, "3256812557229083")
        evidence = dom.read_pdp_dom_evidence(
            page(price=None, currency=None, additional=wrong), ITEM, URL
        )
        self.assertIsNone(evidence["priceCandidate"])

    def test_multivariant_not_selected_is_not_price_proof(self):
        selector = (
            '<select name="sku"><option value="A">Black</option>'
            '<option value="B">White</option></select>'
        )
        evidence = dom.read_pdp_dom_evidence(
            page(additional=selector), ITEM, URL
        )
        self.assertEqual(evidence["variantState"], "MULTIPLE_VARIANTS_NOT_SELECTED")
        self.assertEqual(evidence["state"], "DOM_PRICE_CANDIDATE_VARIANT_AMBIGUOUS")
        self.assertFalse(evidence["pdpPriceVerified"])

    def test_visible_old_or_coupon_price_does_not_become_pdp_price(self):
        visible = (
            '<div class="product-price"><del class="old-price">SAR 200</del>'
            '<span class="price-current">SAR 13.90</span>'
            '<span class="coupon-price">SAR 3.00</span></div>'
        )
        evidence = dom.read_pdp_dom_evidence(
            page(price=None, currency=None, additional=visible), ITEM, URL
        )
        self.assertEqual(
            evidence["state"], "DOM_CURRENT_PRICE_WITH_EXPLICIT_CURRENCY_MISSING"
        )
        self.assertIsNone(evidence["priceCandidate"])
        self.assertGreater(evidence["visiblePriceElements"], 0)

    def test_malformed_large_document_and_wrong_requested_id_fail_closed(self):
        self.assertEqual(
            dom.read_pdp_dom_evidence("x" * 3_500_001, ITEM, URL)["state"],
            "DOM_INPUT_OR_DOCUMENT_ID_INVALID",
        )
        self.assertEqual(
            dom.read_pdp_dom_evidence(page(), "3256812557229083", URL)["state"],
            "DOM_INPUT_OR_DOCUMENT_ID_INVALID",
        )


class DomPdpIntegrationTests(unittest.TestCase):
    @staticmethod
    def run_pdp(document):
        robots = "User-agent: *\nAllow: /\n"

        class Response:
            def __init__(self, url, body, content_type):
                self.url = url
                self.content = body.encode("utf8")
                self.text = body
                self.status_code = 200
                self.headers = {"content-type": content_type}

        class Session:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def get(self, url, *, headers, timeout, allow_redirects):
                if url.endswith("/robots.txt"):
                    return Response(url, robots, "text/plain")
                if url == URL:
                    return Response(url, document, "text/html")
                raise AssertionError("Unexpected network destination")

        with patch.object(pdp.requests, "Session", return_value=Session()):
            return pdp.probe_item(ITEM)

    def test_dom_only_price_candidate_still_not_publishable(self):
        report = self.run_pdp(page())
        self.assertEqual(report["conclusion"], "PDP_PRODUCT_DOM_PRICE_CANDIDATE")
        self.assertEqual(
            report["productIdentity"]["dom"]["priceCandidate"]["currency"], "SAR"
        )
        self.assertFalse(report["customerPublishable"])

    def test_dom_jsonld_conflict_is_blocked(self):
        structured = (
            '<script type="application/ld+json">'
            '{"@type":"Product","url":"' + URL + '","sku":"' + ITEM + '",'
            '"offers":{"@type":"Offer","price":"77.99","priceCurrency":"SAR"}}'
            "</script>"
        )
        report = self.run_pdp(page(extra_head=structured))
        self.assertEqual(report["conclusion"], "PDP_PRICE_EVIDENCE_CONFLICT")
        self.assertFalse(report["customerPublishable"])

    def test_challenge_page_cannot_become_dom_price_candidate(self):
        report = self.run_pdp(
            page(extra_head='<script>window._security="g-recaptcha";</script>')
        )
        self.assertEqual(report["conclusion"], "PDP_CHALLENGE_NOT_CATALOG")
        self.assertNotIn("productIdentity", report)


if __name__ == "__main__":
    unittest.main()
