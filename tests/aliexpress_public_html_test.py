"""Deterministic anti-contamination invariants for AliExpress's live HTML probe."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "scripts" / "aliexpress-public-html-live.py"
spec = importlib.util.spec_from_file_location("aliexpress_probe", SOURCE)
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)

PID = "1005009881103371"
TITLE = "Wireless Bluetooth Earbuds Stereo Headphones"
URL = "https://ar.aliexpress.com/item/" + PID + ".html?gatewayAdapt=glo2ara"
IMAGE = "https://ae04.alicdn.com/kf/realproduct.jpg"


def search_html(*, price="19.99", currency="USD", url=URL, image=IMAGE,
                max_price=None):
    item = {
        "productId": PID, "redirectedId": PID, "itemType": "productV3",
        "title": {"displayTitle": TITLE},
        "image": {"imgUrl": image},
        "prices": {"salePrice": {"minPrice": price, "currencyCode": currency}},
        "productDetailUrl": url,
    }
    if max_price is not None:
        item["prices"]["salePrice"]["maxPrice"] = max_price
    payload = {"root": {"fields": {"mods": {"itemList": {"content": [item]}}}}}
    return (
        "<html><body><script>"
        "window._dida_config_._init_data_ = {data: "
        + json.dumps(payload) +
        "};</script></body></html>"
    )


class AliExpressEvidenceTests(unittest.TestCase):
    def test_string_aware_embedded_json_and_product_card(self):
        html = search_html()
        stats, cards = probe.parsed_search_cards(html, "Bluetooth Earbuds")
        self.assertEqual(stats["parser"], "ALIEXPRESS_EMBEDDED_INIT_DATA")
        self.assertEqual(stats["accepted"], 1)
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["productId"], PID)
        self.assertEqual(cards[0]["currency"], "USD")
        self.assertEqual(cards[0]["priceOriginal"], "19.99")
        self.assertEqual(cards[0]["image"], IMAGE)
        self.assertEqual(cards[0]["sourceUrl"], URL.split("?")[0])
        self.assertFalse(cards[0]["pdpPriceVerified"])
        self.assertFalse(cards[0]["customerPublishable"])

    def test_real_source_link_required_and_exact_pid(self):
        for url in (
            "https://aliexpress.com/p/BundleDeals2.html",
            "https://aliexpress.com/item/1005009881103372.html",
            "https://www.aliexpress.com.evil.example/item/" + PID + ".html",
            "http://www.aliexpress.com/item/" + PID + ".html",
            "https://attacker.example/item/" + PID + ".html",
            "https://www.aliexpress.com:8443/item/" + PID + ".html",
            "https://user:pw@www.aliexpress.com/item/" + PID + ".html",
        ):
            stats, cards = probe.parsed_search_cards(search_html(url=url), "Bluetooth")
            self.assertEqual(cards, [], url)
            self.assertEqual(stats["rejected"]["SOURCE_PDP_LINK_IDENTITY_UNVERIFIED"], 1)
        self.assertIsNone(probe.product_link(None, PID))

    def test_embedded_productv3_fallback_without_init_data_wrapper(self):
        item = {
            "redirectedId": PID, "productId": PID, "itemType": "productV3",
            "title": {"displayTitle": TITLE},
            "prices": {"salePrice": {"minPrice": "19.99", "currencyCode": "SAR"}},
            "image": {"imgUrl": IMAGE},
            "productDetailUrl": URL,
        }
        html = "<html><script>window.__search = " + json.dumps(item) + ";</script></html>"
        stats, cards = probe.parsed_search_cards(html, "Bluetooth")
        self.assertEqual(stats["parser"], "ALIEXPRESS_STRUCTURED_PRODUCTV3_OBJECTS")
        self.assertEqual(stats["sourceItems"], 1)
        self.assertEqual(stats["accepted"], 1)
        self.assertEqual(cards[0]["priceOriginal"], "19.99")
        self.assertEqual(cards[0]["currency"], "SAR")

    def test_product_id_is_never_promoted_to_a_guessed_url(self):
        item = {
            "redirectedId": PID, "productId": PID, "itemType": "productV3",
            "title": {"displayTitle": TITLE},
            "prices": {"salePrice": {"minPrice": "19.99", "currencyCode": "SAR"}},
            "image": {"imgUrl": IMAGE},
        }
        html = "<html><script>window.__search = " + json.dumps(item) + ";</script></html>"
        stats, cards = probe.parsed_search_cards(html, "Bluetooth")
        self.assertEqual(cards, [])
        self.assertEqual(
            stats["rejected"]["SOURCE_PDP_LINK_IDENTITY_UNVERIFIED"], 1
        )
        source_url = "https://ar.aliexpress.com/item/" + PID + ".html"
        with_link = html.replace(
            "</html>", '<a href="' + source_url + '">same item</a></html>'
        )
        _, cards = probe.parsed_search_cards(with_link, "Bluetooth")
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["sourceUrl"], source_url)

    def test_sale_price_currency_and_image_required(self):
        for price, currency, image in (
            ("1e3", "USD", IMAGE),
            ("-5", "USD", IMAGE),
            ("5.123", "USD", IMAGE),
            ("NaN", "USD", IMAGE),
            ("19.99", None, IMAGE),
            ("19.99", "BAD!", IMAGE),
            ("19.99", "USD", "https://evil.example/p.jpg"),
        ):
            stats, cards = probe.parsed_search_cards(
                search_html(price=price, currency=currency, image=image),
                "Bluetooth",
            )
            self.assertEqual(cards, [], (price, currency, image))
            self.assertTrue(stats["rejected"])

    def test_variant_range_preserved_not_pretended_exact_pdp_price(self):
        _, cards = probe.parsed_search_cards(search_html(max_price="29.99"), "Earbuds")
        self.assertEqual(cards[0]["maxVariantPrice"], "29.99")
        self.assertEqual(cards[0]["priceKind"], "SEARCH_CARD_MINIMUM_VARIANT_UNVERIFIED")
        self.assertFalse(cards[0]["customerPublishable"])

    def test_live_observed_aliexpress_media_cdn_is_trusted_but_impostors_are_not(self):
        first_party = "https://ae-pic-a1.aliexpress-media.com/kf/test-product.webp"
        stats, cards = probe.parsed_search_cards(
            search_html(image=first_party), "Bluetooth"
        )
        self.assertEqual(stats["accepted"], 1)
        self.assertEqual(cards[0]["image"], first_party)
        for fake in (
            "https://ae-pic-a1.aliexpress-media.com.evil.example/kf/fake.webp",
            "http://ae-pic-a1.aliexpress-media.com/kf/fake.webp",
            "https://evil-aliexpress-media.com/kf/fake.webp",
            "https://bad.example/aliexpress-media.com/kf/fake.webp",
        ):
            self.assertIsNone(probe.product_image(fake))

    def test_price_collision_and_irrelevance_are_dropped(self):
        html = search_html()
        stats, cards = probe.parsed_search_cards(html, "coffee machine")
        self.assertEqual(cards, [])
        self.assertEqual(stats["rejected"]["QUERY_NOT_RELEVANT"], 1)

    def test_challenge_is_not_a_zero_inventory_snapshot(self):
        self.assertEqual(
            probe.classify_html("<html>_____tmd_____ recaptcha</html>"),
            "CHALLENGE_PAGE_NOT_PRODUCT_EVIDENCE",
        )
        self.assertEqual(
            probe.classify_html("<html>plain shell</html>"),
            "THIN_OR_UNHYDRATED_SEARCH_HTML",
        )


if __name__ == "__main__":
    unittest.main()
