"""Same-ID JSON-LD price checks for live AliExpress PDP diagnostics."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "scripts" / "aliexpress-pdp-evidence-live.py"
spec = importlib.util.spec_from_file_location("aliexpress_pdp", MODULE)
pdp = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = pdp
spec.loader.exec_module(pdp)

PID = "1005012743543835"


def html_for(pid=PID, *, price="6.29", currency="SAR", url=None,
             offer_url=None, sku=None):
    product = {
        "@context": "https://schema.org",
        "@type": "Product",
        "url": url or ("https://ar.aliexpress.com/item/" + pid + ".html"),
        "sku": sku or pid,
        "name": "Wireless Headphones",
        "offers": {
            "@type": "Offer", "price": price, "priceCurrency": currency,
        },
    }
    if offer_url is not None:
        product["offers"]["url"] = offer_url
    return (
        '<html><head><meta property="og:title" content="Headphones"></head><body>'
        '<script type="application/ld+json">' + json.dumps(product) +
        "</script></body></html>"
    )


class PdpEvidenceTests(unittest.TestCase):
    def test_exact_item_offer_candidate(self):
        r = pdp.safely_matched_product_jsonld(html_for(), PID)
        self.assertEqual(r["state"], "SAME_ITEM_JSONLD_PRICE_CANDIDATE")
        self.assertEqual(r["priceEvidence"]["priceOriginal"], "6.29")
        self.assertEqual(r["priceEvidence"]["currency"], "SAR")
        self.assertFalse(r["priceEvidence"]["offerUrlMatched"])

    def test_cross_sku_or_product_url_fails(self):
        mismatch_id = "1005009157591241"
        for html in (
            html_for(pid=mismatch_id),
            html_for(url="https://evil.example/item/" + PID + ".html"),
            html_for(offer_url="https://ar.aliexpress.com/item/" + mismatch_id + ".html"),
            html_for(sku=mismatch_id),
        ):
            out = pdp.safely_matched_product_jsonld(html, PID)
            self.assertNotIn("priceEvidence", out)

    def test_missing_or_malformed_offer_is_not_attested(self):
        for raw in ("0", "-6", "NaN", "1e3", "6.2999"):
            self.assertNotIn("priceEvidence", pdp.safely_matched_product_jsonld(
                html_for(price=raw), PID
            ))
        self.assertNotIn("priceEvidence", pdp.safely_matched_product_jsonld(
            html_for(currency=""), PID
        ))

    def test_identical_duplicate_jsonld_is_still_ambiguous(self):
        raw = html_for()
        product = json.dumps({
            "@type": "Product",
            "url": "https://ar.aliexpress.com/item/" + PID + ".html",
            "sku": PID,
            "offers": {"@type": "Offer", "price": "6.29", "priceCurrency": "SAR"},
        })
        doubled = raw.replace("</body>", '<script type="application/ld+json">' +
                              product + "</script></body>")
        self.assertEqual(
            pdp.safely_matched_product_jsonld(doubled, PID)["state"],
            "NO_UNAMBIGUOUS_EXACT_ID_PRODUCT_JSONLD",
        )

    def test_url_marketing_price_never_generates_product_evidence(self):
        html = '<html><head><meta property="og:title" content="Headphones"></head>' \
               "<body>pdp_npi=6%40dis%21SAR%2157.97%216.29</body></html>"
        self.assertNotIn(
            "priceEvidence", pdp.safely_matched_product_jsonld(html, PID)
        )


if __name__ == "__main__":
    unittest.main()
