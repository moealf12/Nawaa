import unittest
from noon_toolchain_trial import strict_price, merchant_identity, parse_source_html

LONG_SLUG = ("matebook-d16-upgraded-version-laptop-with-16-inch-full-hd-1920x1080-display-"
             "core-i5-12450h-processor-16gb-ram-ddr5-512gb-ssd-windows-11-pro-with-"
             "microsoft-office-english-arabic-mystic-silver-english-arabic-mystic-silver")
PDP = "https://www.noon.com/saudi-en/" + LONG_SLUG + "/N70312362V/p/?o=f428b90c38b7fb5b"


def card(price="2,489", url=PDP, model="Huawei MateBook D16 Laptop"):
    return ('<a href="' + url + '">'
            '<h2 data-qa="plp-product-box-name">' + model + '</h2>'
            '<div data-qa="plp-product-box-price"><span class="oldPrice">5,100</span>'
            '<strong class="amount_a2gq6_61">' + price + '</strong></div>'
            '<img src="https://f.nooncdn.com/p/fixture.jpg"></a>')


class TrialFixtures(unittest.TestCase):
    def test_prices_are_dedicated_complete_values(self):
        self.assertEqual(strict_price("SAR 2,489.00"), "2489.00")
        self.assertEqual(strict_price("2489"), "2489")
        self.assertIsNone(strict_price("Core i5-12450H"))
        self.assertIsNone(strict_price("Save 40%"))
        self.assertIsNone(strict_price("18,518 riyal and discount 50%"))
        self.assertIsNone(strict_price("model 5070"))
        self.assertIsNone(strict_price("0"))
        self.assertIsNone(strict_price("SAR 2,489.999"))

    def test_exact_sku_and_reject_other_market(self):
        self.assertEqual(merchant_identity(PDP), "N70312362V")
        self.assertIsNone(merchant_identity(PDP.replace("saudi-en", "uae-en")))
        self.assertIsNone(merchant_identity(PDP.replace("www.noon.com", "www.noon.com.evil.test")))
        self.assertIsNone(merchant_identity(PDP.replace("N70312362V", "N70312362X")))

    def test_search_cards_reject_synthetic_page(self):
        self.assertEqual(parse_source_html("<html><div id='root'></div></html>")["status"],
                         "SEARCH_CONTEXT_NOT_ATTESTED")
        self.assertEqual(parse_source_html("<h1>iPhone</h1>" + card())["status"],
                         "SEARCH_CONTEXT_NOT_ATTESTED")

    def test_valid_source_card_observed_not_customer_published(self):
        report = parse_source_html("<h1>Laptop</h1>" + card())
        self.assertEqual(report["status"], "SOURCE_CARD_EVIDENCE")
        self.assertEqual(report["cards"], 1)
        self.assertEqual(report["unique_offers"], 1)
        self.assertFalse(report["customer_publishable"])

    def test_conflicting_prices_held(self):
        report = parse_source_html("<h1>Laptop</h1>" + card("2,489") + card("2,499"))
        self.assertEqual(report["cards"], 2)
        self.assertEqual(report["unique_offers"], 0)
        self.assertEqual(report["conflicts"], 1)

    def test_wrong_host_or_unscoped_price_refused(self):
        report = parse_source_html("<h1>Laptop</h1>" +
                                   card(url="https://evil.test/saudi-en/gadget/N70312362V/p/") +
                                   card(price="SAVE 50%"))
        self.assertEqual(report["unique_offers"], 0)


if __name__ == "__main__":
    unittest.main()
