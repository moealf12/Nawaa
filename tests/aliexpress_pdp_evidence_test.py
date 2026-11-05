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

    def test_robots_accepts_plain_text_and_pdp_accepts_html(self):
        from unittest.mock import patch

        observed = []
        robots = "User-agent: *\nAllow: /\n"

        class Response:
            def __init__(self, url, raw, content_type):
                self.url = url
                self.content = raw.encode("utf8")
                self.text = raw
                self.status_code = 200
                self.headers = {"content-type": content_type}

        class Session:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def get(self, url, *, headers, timeout, allow_redirects):
                observed.append((url, headers["accept"]))
                if url.endswith("/robots.txt"):
                    return Response(url, robots, "text/plain")
                return Response(url, html_for(), "text/html")

        with patch.object(pdp.requests, "Session", return_value=Session()):
            report = pdp.probe_item(PID)
        self.assertEqual(report["stages"][0]["state"], "ALLOWED")
        self.assertEqual(report["stages"][1]["state"], "PDP_HTML_RECEIVED")
        self.assertEqual(observed[0][1], "text/plain")
        self.assertIn("text/html", observed[1][1])
        self.assertEqual(report["conclusion"], "PDP_PRODUCT_JSONLD_PRICE_CANDIDATE")

    def test_only_exact_item_official_redirect_is_eligible(self):
        here = "https://ar.aliexpress.com/item/" + PID + ".html"
        safe = "https://www.aliexpress.com/item/" + PID + ".html"
        approved, reason = pdp.approved_pdp_redirect(
            safe + "?tracking=ignored", here, PID
        )
        self.assertEqual(approved, safe)
        self.assertEqual(reason, "REDIRECT_SAME_ITEM_APPROVED")
        for bad in (
            "https://www.aliexpress.com/p/BundleDeals2.html",
            "https://www.aliexpress.com/item/1005009157591241.html",
            "https://www.aliexpress.com.punish.example/item/" + PID + ".html",
            "http://www.aliexpress.com/item/" + PID + ".html",
            "https://www.aliexpress.com:8443/item/" + PID + ".html",
            "https://www.aliexpress.com/punish?foo=bar",
            "/p/verify?challenge=1",
            "//evil.example/item/" + PID + ".html",
        ):
            new, _ = pdp.approved_pdp_redirect(bad, here, PID)
            self.assertIsNone(new, bad)
        self.assertEqual(
            pdp.approved_pdp_redirect(
                "/punish?challenge=1", here, PID
            )[1],
            "CHALLENGE_OR_LOGIN_REDIRECT",
        )
        self.assertEqual(
            pdp.approved_pdp_redirect(
                here + "?foo=bar", here, PID
            )[1],
            "REDIRECT_TO_SAME_CANONICAL_ITEM",
        )

    def test_redirect_target_diagnostics_never_include_tracking_or_secrets(self):
        current = "https://ar.aliexpress.com/item/" + PID + ".html"
        root = pdp.classify_redirect_destination(
            "https://www.aliexpress.com/?token=secrets-123", current, PID
        )
        self.assertEqual(root["targetHostClass"], "OFFICIAL")
        self.assertEqual(root["targetPathClass"], "ROOT")
        self.assertTrue(root["hasQuery"])
        self.assertNotIn("token", str(root))
        exact = pdp.classify_redirect_destination(
            "https://www.aliexpress.com/item/" + PID + ".html?tracking=bad",
            current, PID
        )
        self.assertEqual(exact["targetPathClass"], "EXACT_ITEM_PDP")
        challenge = pdp.classify_redirect_destination(
            "/punish?captcha=123", current, PID
        )
        self.assertEqual(challenge["targetPathClass"], "CHALLENGE_OR_AUTH")
        external = pdp.classify_redirect_destination(
            "https://evil.example/item/" + PID + ".html?secret=1", current, PID
        )
        self.assertEqual(external["targetHostClass"], "OTHER")
        self.assertIsNone(external["targetHost"])
        self.assertNotIn("evil.example", str(external))
        self.assertNotIn("secret", str(external))

    def test_safe_cross_host_redirect_checks_target_robots_and_jsonld(self):
        from unittest.mock import patch

        calls = []
        robots = "User-agent: *\nAllow: /\n"
        start = "https://ar.aliexpress.com/item/" + PID + ".html"
        target = "https://www.aliexpress.com/item/" + PID + ".html"

        class Response:
            def __init__(self, url, status, text="", content_type="text/html",
                         location=None):
                self.url = url
                self.status_code = status
                self.content = text.encode("utf8")
                self.text = text
                self.headers = {"content-type": content_type}
                if location:
                    self.headers["location"] = location

        class Session:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def get(self, url, *, headers, timeout, allow_redirects):
                calls.append((url, headers["accept"], allow_redirects))
                if url.endswith("robots.txt"):
                    return Response(url, 200, robots, "text/plain")
                if url == start:
                    return Response(url, 302, location=target + "?track=123")
                if url == target:
                    return Response(url, 200, html_for())
                raise AssertionError("Unexpected external request")

        with patch.object(pdp.requests, "Session", return_value=Session()):
            report = pdp.probe_item(PID)
        self.assertEqual(report["conclusion"], "PDP_PRODUCT_JSONLD_PRICE_CANDIDATE")
        self.assertEqual(report["redirectsFollowed"], 1)
        self.assertEqual(
            [x["host"] for x in report["stages"] if x["step"] == "robots_policy"],
            ["ar.aliexpress.com", "www.aliexpress.com"]
        )
        self.assertEqual(report["productIdentity"]["jsonLd"]["priceEvidence"]["currency"],
                         "SAR")
        self.assertEqual(sum(url.endswith("robots.txt") for url, _, _ in calls), 2)
        self.assertTrue(all(allow_redirects is False for _, _, allow_redirects in calls))
        self.assertFalse(any("track=" in url for url, _, _ in calls))
        self.assertFalse(report["customerPublishable"])

    def test_cross_host_redirect_denied_without_destination_robots(self):
        from unittest.mock import patch
        start = "https://ar.aliexpress.com/item/" + PID + ".html"
        target = "https://www.aliexpress.com/item/" + PID + ".html"
        calls = []

        class Response:
            def __init__(self, url, status, text="", location=None):
                self.url = url
                self.status_code = status
                self.content = text.encode()
                self.text = text
                self.headers = {"content-type": "text/plain" if url.endswith("txt") else "text/html"}
                if location:
                    self.headers["location"] = location

        class Session:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def get(self, url, *, headers, timeout, allow_redirects):
                calls.append(url)
                if url.endswith("/robots.txt"):
                    return Response(url, 403 if "www." in url else 200,
                                    "User-agent: *\nAllow: /\n")
                if url == start:
                    return Response(url, 302, location=target)
                raise AssertionError("PDP on denied host must not be requested")

        with patch.object(pdp.requests, "Session", return_value=Session()):
            report = pdp.probe_item(PID)
        self.assertEqual(report["conclusion"], "ROBOTS_POLICY_NOT_VERIFIED")
        self.assertNotIn(target, calls)
        self.assertFalse(report["customerPublishable"])

    def test_challenge_redirect_never_requested_or_price_promoted(self):
        from unittest.mock import patch
        calls = []

        class Response:
            def __init__(self, url, status=200, location=None, body=""):
                self.url = url
                self.status_code = status
                self.content = body.encode()
                self.text = body
                self.headers = {"content-type": "text/plain" if url.endswith("txt") else "text/html"}
                if location is not None:
                    self.headers["location"] = location

        class Session:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def get(self, url, *, headers, timeout, allow_redirects):
                calls.append(url)
                if url.endswith("/robots.txt"):
                    return Response(url, body="User-agent: *\nAllow: /\n")
                if "/item/" in url:
                    return Response(url, 302, "/punish?captcha=1")
                raise AssertionError("Challenge follow would be unsafe")

        with patch.object(pdp.requests, "Session", return_value=Session()):
            report = pdp.probe_item(PID)
        self.assertEqual(report["conclusion"], "PDP_CHALLENGE_OR_LOGIN_REDIRECT")
        self.assertEqual(report["redirectsFollowed"], 0)
        self.assertTrue(all("/punish" not in url for url in calls))
        self.assertFalse(report["customerPublishable"])

    def test_url_marketing_price_never_generates_product_evidence(self):
        html = '<html><head><meta property="og:title" content="Headphones"></head>' \
               "<body>pdp_npi=6%40dis%21SAR%2157.97%216.29</body></html>"
        self.assertNotIn(
            "priceEvidence", pdp.safely_matched_product_jsonld(html, PID)
        )


if __name__ == "__main__":
    unittest.main()
