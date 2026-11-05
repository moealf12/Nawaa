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


    def test_product_specs_and_bundle_prices_never_become_main_offer(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        html = """<link rel="canonical" href="https://www.amazon.com/dp/B0C3HCD34R" />
        <input id="ASIN" value="B0C3HCD34R" />
        <span id="productTitle">Soundcore Q20i Wireless Bluetooth Black Headphones</span>
        <img id="landingImage" src="https://m.media-amazon.com/images/I/pdp.jpg" />
        <div id="ProductSpecs-1"><span class="a-price"><span class="a-offscreen">$12.99</span></span></div>
        <div id="sims-productBundle_feature_div_0"><span class="a-price"><span class="a-offscreen">$40.00</span></span></div>"""
        product = parse_amazon_us_pdp(html, "https://www.amazon.com/dp/B0C3HCD34R")[0]
        self.assertIsNone(product.price)
        self.assertIsNone(product.currency)
        self.assertIn("AMAZON_PDP_PRIMARY_PRICE_NOT_EVIDENCED", product.issues)



class AmazonPdpRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_primary_price_single_retry_recovers_but_not_parity(self):
        from unittest.mock import AsyncMock, patch
        import nawaa_store_hunter as m
        asin = "B0C3HCD34R"
        title = "Soundcore Q20i Wireless Bluetooth Black Headphones"
        plp = f'''<div data-component-type="s-search-result" data-asin="{asin}">
          <h2><a href="/dp/{asin}">{title}</a></h2>
          <img class="s-image" src="https://m.media-amazon.com/images/I/plp.jpg" /></div>'''
        common = f'''<link rel="canonical" href="https://www.amazon.com/dp/{asin}" />
          <input id="ASIN" value="{asin}"/>
          <span id="productTitle">{title}</span>
          <img id="landingImage" src="https://m.media-amazon.com/images/I/pdp.jpg" />'''
        priced = common + '<div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$44.99</span></span></div>'
        calls = []
        async def fake_fetch(method, url, params=None, headers=None):
            calls.append(method)
            if method == "homepage":
                return "<html></html>"
            if method == "search-html":
                return plp
            if method == "product-detail":
                return common
            if method == "product-detail-price-retry":
                return priced
            raise AssertionError(method)
        s = m.Scraper("https://www.amazon.com", "wireless headphones", 1, 1, "never", "all")
        s.prepare = AsyncMock()
        s.fetch = fake_fetch
        s.search_targets = lambda _: [("https://www.amazon.com/s", {"k": "wireless headphones"})]
        with patch.object(m.asyncio, "sleep", new_callable=AsyncMock):
            result = await s.search()
        await s.close()
        self.assertEqual(result["count"], 1)
        product = result["products"][0]
        self.assertEqual(product["sku"], asin)
        self.assertEqual(product["price"], "44.99")
        self.assertEqual(product["currency"], "USD")
        self.assertEqual(product["price_status"], "single_source_unverified")
        self.assertIn("AMAZON_PDP_RETRY_PRICE_RECOVERED", product["issues"])
        self.assertEqual(calls.count("product-detail-price-retry"), 1)
        self.assertTrue(any(d.status=="AMAZON_MISSING_PRIMARY_PRICE_NEGOTIATION_RETRY_ONCE" for d in s.diagnostics))

    async def test_ambiguous_amazon_main_price_does_not_retry(self):
        from unittest.mock import AsyncMock
        import nawaa_store_hunter as m
        asin = "B0C3HCD34R"
        title = "Soundcore Q20i Wireless Bluetooth Black Headphones"
        plp = f'''<div data-component-type="s-search-result" data-asin="{asin}">
          <h2><a href="/dp/{asin}">{title}</a></h2></div>'''
        ambiguous = f'''<link rel="canonical" href="https://www.amazon.com/dp/{asin}" />
          <input id="ASIN" value="{asin}"/><span id="productTitle">{title}</span>
          <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$44.99</span></span>
          <span class="a-price"><span class="a-offscreen">$54.99</span></span></div>'''
        calls = []
        async def fake_fetch(method, url, params=None, headers=None):
            calls.append(method)
            if method == "homepage": return "<html></html>"
            if method == "search-html": return plp
            if method == "product-detail": return ambiguous
            raise AssertionError(method)
        s = m.Scraper("https://www.amazon.com", "wireless headphones", 1, 1, "never", "all")
        s.prepare = AsyncMock()
        s.fetch = fake_fetch
        s.search_targets = lambda _: [("https://www.amazon.com/s", {"k": "wireless headphones"})]
        result = await s.search()
        await s.close()
        self.assertEqual(result["products"][0]["price"], None)
        self.assertNotIn("product-detail-price-retry", calls)


class AmazonHeaderFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def _exercise(self, codes, method="search-html", final_followup=False):
        import httpx
        from unittest.mock import patch
        import nawaa_store_hunter as m
        baseline = "text/html,application/json;q=0.9,*/*;q=0.8"
        requests = []
        statuses = iter(codes)
        def handler(req):
            requests.append({
                "url": str(req.url), "accept": req.headers.get("accept"),
                "language": req.headers.get("accept-language"),
                "user_agent": req.headers.get("user-agent"),
            })
            return httpx.Response(next(statuses), text="<html>public</html>")
        scraper = m.Scraper("https://www.amazon.com", "headphones", 4, 1, "never")
        await scraper._client.aclose()
        scraper._client = httpx.AsyncClient(
            transport=httpx.MockTransport(handler), follow_redirects=False,
            headers={"User-Agent": m.USER_AGENT, "Accept": baseline})
        with patch.object(m, "ensure_public_url", side_effect=lambda u, origin=None: u), \
             patch.object(scraper, "permitted", return_value=True), \
             patch.object(m.asyncio, "sleep", new_callable=__import__("unittest").mock.AsyncMock) as sleep:
            body = await scraper.fetch(method, "https://www.amazon.com/s", {"k": "headphones"})
            if final_followup:
                await scraper.fetch("product-detail", "https://www.amazon.com/dp/B0C3HCD34R")
        diagnostics = [x.status for x in scraper.diagnostics]
        await scraper.close()
        return body, requests, diagnostics, sleep.await_count, baseline, m.USER_AGENT

    async def test_transient_503_uses_alternate_once_then_baseline(self):
        body, reqs, statuses, delays, baseline, ua = await self._exercise([503, 200, 200], final_followup=True)
        self.assertEqual(body, "<html>public</html>")
        self.assertEqual(len(reqs), 3)
        self.assertEqual([r["accept"] == baseline for r in reqs], [True, False, True])
        self.assertEqual([r["language"] for r in reqs], [None, "en-US,en;q=0.8", None])
        self.assertTrue(all(r["user_agent"] == ua for r in reqs))
        self.assertEqual(reqs[0]["url"], reqs[1]["url"])
        self.assertEqual(delays, 1)
        self.assertIn("TRANSIENT_HTTP_HEADER_FALLBACK_ONCE", statuses)
        self.assertIn("HEADER_PROFILE_RESTORED", statuses)

    async def test_second_503_stops_no_unbounded_retry(self):
        body, reqs, statuses, delays, _, _ = await self._exercise([503, 503])
        self.assertIsNone(body)
        self.assertEqual(len(reqs), 2)
        self.assertEqual(delays, 1)
        self.assertIn("HTTP_ERROR", statuses)

    async def test_transient_500_502_504_each_bounded(self):
        for code in (500, 502, 504):
            with self.subTest(code=code):
                body, reqs, _, delays, _, _ = await self._exercise([code, 200])
                self.assertEqual(body, "<html>public</html>")
                self.assertEqual(len(reqs), 2)
                self.assertEqual(delays, 1)

    async def test_never_rotate_on_rate_limit_or_denial(self):
        for code in (401, 403, 404, 429):
            with self.subTest(code=code):
                body, reqs, statuses, delays, _, _ = await self._exercise([code])
                self.assertIsNone(body)
                self.assertEqual(len(reqs), 1)
                self.assertEqual(delays, 0)
                self.assertNotIn("TRANSIENT_HTTP_HEADER_FALLBACK_ONCE", statuses)

    async def test_nonsearch_pdp_503_never_rotates(self):
        body, reqs, _, delays, _, _ = await self._exercise([503], method="product-detail")
        self.assertIsNone(body)
        self.assertEqual(len(reqs), 1)
        self.assertEqual(delays, 0)


class AmazonIntentRelevanceTests(unittest.TestCase):
    """Adversarial title examples only: not live result evidence."""
    def classify(self, query, title):
        from nawaa_store_hunter import classify_product_intent
        return classify_product_intent(query, title)

    def test_ps5_portal_not_console(self):
        match, reasons, _ = self.classify("PlayStation 5 console", "PlayStation 5 Portal Remote Player")
        self.assertEqual(match, "mismatch")
        self.assertIn("ACCESSORY_NOT_PS5_CONSOLE", reasons)

    def test_ps5_console_without_price_still_correct_type(self):
        match, _, _ = self.classify("PlayStation 5 console", "PlayStation 5 Console 1TB")
        self.assertEqual(match, "exact")

    def test_ps5_digital_console_not_disc_drive(self):
        match, _, _ = self.classify("PS5 disc drive", "PlayStation 5 Digital Edition PS5 Slim Console")
        self.assertNotEqual(match, "exact")

    def test_ps5_external_ssd_not_disc_drive(self):
        match, reasons, _ = self.classify("PS5 disc drive", "Seagate Game Drive PS5 NVMe SSD 2TB")
        self.assertEqual(match, "mismatch")
        self.assertIn("SSD_STORAGE_NOT_DISC_DRIVE", reasons)

    def test_actual_disc_drive_passes(self):
        match, _, _ = self.classify("PS5 disc drive", "PlayStation Disc Drive For PS5 Digital Edition Consoles slim")
        self.assertEqual(match, "exact")

    def test_laptop_8gb_does_not_satisfy_16gb(self):
        match, reasons, _ = self.classify("laptop 16GB RAM", "Lenovo 15.6 Inch Essential Laptop 8GB DDR5 128GB Storage")
        self.assertEqual(match, "mismatch")
        self.assertIn("RAM_CAPACITY_CONFLICT", reasons)

    def test_laptop_16gb_unified_memory_is_valid(self):
        match, _, _ = self.classify("laptop 16GB RAM", "MacBook Air 13-inch Laptop 16GB Unified Memory")
        self.assertEqual(match, "exact")

    def test_laptop_unknown_ram_is_unclassified(self):
        match, _, _ = self.classify("laptop 16GB RAM", "High Performance Laptop 1TB SSD")
        self.assertEqual(match, "unclassified")

    def test_iphone17_pro_not_base_variant(self):
        match, _, _ = self.classify("iPhone 17", "iPhone 17 Pro US Version 256GB")
        self.assertEqual(match, "related")

    def test_iphone_renewed_condition_is_preserved(self):
        match, _, condition = self.classify("iPhone 17", "iPhone 17 US Version 512GB Renewed Premium")
        self.assertEqual(match, "exact")
        self.assertEqual(condition, "renewed_premium")

    def test_s25_ultra_related_to_base(self):
        match, _, _ = self.classify("Samsung Galaxy S25", "Samsung Galaxy S25 Ultra 256GB")
        self.assertEqual(match, "related")

    def test_4k_monitor_not_tv(self):
        match, _, _ = self.classify("4K monitor", "Sony Bravia 55-inch 4K UHD Smart TV")
        self.assertEqual(match, "mismatch")

    def test_robot_vacuum(self):
        match, _, _ = self.classify("robot vacuum", "roborock robot vacuum and mop")
        self.assertEqual(match, "exact")

    def test_wireless_earbuds_related_to_overear(self):
        match, _, _ = self.classify("wireless headphones", "Wireless Earbuds Bluetooth In-ear Headset")
        self.assertEqual(match, "related")

    def test_arabic_bluetooth_audio(self):
        match, _, _ = self.classify("سماعات بلوتوث", "JBL True Wireless Earbuds Bluetooth 5.3")
        self.assertEqual(match, "exact")

    def test_unfamiliar_search_is_not_falsely_exact(self):
        match, reasons, _ = self.classify("rare keyboard 65% layout", "gaming mouse pad")
        self.assertEqual(match, "unclassified")
        self.assertIn("NO_EXPLICIT_INTENT_RULE", reasons)


class AmazonLiveFalsePositiveRegressions(unittest.TestCase):
    """Real observed product titles (structure only), not mocked live outcomes."""
    def classify(self, q, title):
        from nawaa_store_hunter import classify_product_intent
        return classify_product_intent(q, title)

    def test_football_video_game_disc_is_not_ps5_console(self):
        title = "EA SPORTS FC 27 Standard Edition PlayStation5 |Physical Disc I VideoGame |English"
        match, reason, _ = self.classify("PlayStation 5 console", title)
        self.assertEqual(match, "mismatch")
        self.assertIn("GAME_NOT_PS5_CONSOLE", reason)

    def test_nba_game_title_cannot_claim_console(self):
        match, _, _ = self.classify("PlayStation 5 console", "NBA 2K27 - PlayStation 5")
        self.assertNotEqual(match, "exact")

    def test_portal_remote_player_not_console(self):
        match, _, _ = self.classify("PlayStation 5 console", "PlayStation 5 Portal Remote Player")
        self.assertEqual(match, "mismatch")

    def test_console_bundle_with_controllers_remains_console(self):
        match, _, _ = self.classify(
            "PlayStation 5 console",
            "Sony PlayStation 5 Pro 2TB SSD Digital Console with Two Controllers and Charging Bundle"
        )
        self.assertEqual(match, "exact")

    def test_controller_for_ps5_console_is_not_console(self):
        match, _, _ = self.classify(
            "PlayStation 5 console", "DualSense Wireless Controller for PlayStation 5 Console"
        )
        self.assertEqual(match, "mismatch")

    def test_ps5_optical_repair_kit_is_not_complete_disc_addon(self):
        match, reasons, _ = self.classify(
            "PS5 disc drive",
            "TOMSIN Disc Drive Replacement for Sony PlayStation 5 KEM-497AAA Optical Drive Accessories Repair Kit"
        )
        self.assertEqual(match, "related")
        self.assertIn("PS5_DISC_DRIVE_REPAIR_PART_NOT_COMPLETE_ADDON", reasons)

    def test_ps5_drive_connector_module_is_not_complete_addon(self):
        match, reasons, _ = self.classify(
            "PS5 disc drive",
            "Blu-ray DVD Disc Drive Connector Module for PS5 CFI-1200 Replacement"
        )
        self.assertEqual(match, "related")

    def test_original_ps5_disc_addon_stays_exact(self):
        match, _, _ = self.classify(
            "PS5 disc drive", "PlayStation Disc Drive For PS5 Digital Edition Consoles (slim)"
        )
        self.assertEqual(match, "exact")

    def test_s25_fe_is_variant_not_base(self):
        match, reasons, _ = self.classify(
            "Samsung Galaxy S25", "Galaxy S25 FE 128GB Jet Black"
        )
        self.assertEqual(match, "related")
        self.assertIn("GALAXY_S25_MODEL_VARIANT_DIFFERENT", reasons)



class AmazonPdpRootCauseRegressions(unittest.TestCase):
    """Do not equate marketing-title numerical drift with a new Amazon ASIN."""
    def product(self, title, sku="B0C3HCD34R", source=False):
        from nawaa_store_hunter import Product
        return Product(
            title=title, url=f"https://www.amazon.com/dp/{sku}",
            sku=sku,
            method="amazon-us-pdp-main-buybox" if source else "amazon-us-html-card",
            issues=["AMAZON_PDP_ASIN_PROOF"] if source else []
        )

    def test_strong_asin_accepts_title_marketing_numbers(self):
        from nawaa_store_hunter import pdp_identity_matches
        plp=self.product("Soundcore Q20i Wireless Headphones 54H Playtime 2026")
        pdp=self.product("Soundcore Q20i Bluetooth Headphones 60H Playtime",source=True)
        self.assertTrue(pdp_identity_matches(plp,pdp))

    def test_asin_proof_required_to_relax_title_numbers(self):
        from nawaa_store_hunter import pdp_identity_matches
        plp=self.product("Soundcore Q20i Wireless Headphones 54H Playtime 2026")
        pdp=self.product("Soundcore Q20i Bluetooth Headphones 60H Playtime")
        pdp.method="amazon-us-pdp-main-buybox"
        self.assertFalse(pdp_identity_matches(plp,pdp))

    def test_different_asin_rejects_even_same_title(self):
        from nawaa_store_hunter import pdp_identity_matches
        plp=self.product("Soundcore Q20i Black Headphones")
        pdp=self.product("Soundcore Q20i Black Headphones",sku="B0CZPLV566",source=True)
        self.assertFalse(pdp_identity_matches(plp,pdp))

    def test_asin_equal_but_storage_conflicting_fails_closed(self):
        from nawaa_store_hunter import pdp_identity_matches
        plp=self.product("Samsung Galaxy S25 128GB Black")
        pdp=self.product("Samsung Galaxy S25 256GB Black",source=True)
        self.assertFalse(pdp_identity_matches(plp,pdp))

    def test_asin_equal_but_variant_conflicting_fails_closed(self):
        from nawaa_store_hunter import pdp_identity_matches
        plp=self.product("Apple iPhone 17 256GB Black")
        pdp=self.product("Apple iPhone 17 Pro 256GB Black",source=True)
        self.assertFalse(pdp_identity_matches(plp,pdp))

    def test_asin_equal_but_color_conflicting_fails_closed(self):
        from nawaa_store_hunter import pdp_identity_matches
        plp=self.product("Soundcore Q20i White Headphones")
        pdp=self.product("Soundcore Q20i Black Headphones",source=True)
        self.assertFalse(pdp_identity_matches(plp,pdp))

    def test_empty_primary_slot_does_not_suppress_valid_second_primary(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        asin="B0C3HCD34R"
        html=f'''<link rel="canonical" href="https://www.amazon.com/dp/{asin}" />
          <input id="ASIN" value="{asin}" />
          <span id="productTitle">Soundcore Q20i Wireless Headphones Black</span>
          <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">Unavailable</span></span></div>
          <div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">$44.99</span></span></div>'''
        out=parse_amazon_us_pdp(html,f"https://www.amazon.com/dp/{asin}")
        self.assertEqual(len(out),1)
        self.assertEqual(out[0].price,"44.99")
        self.assertIn("AMAZON_PDP_PRIMARY_PRICE_SOURCE_COREPRICEDISPLAY_DESKTOP",out[0].issues)

    def test_two_buybox_modules_with_different_prices_fail_closed(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        asin="B0C3HCD34R"
        html=f'''<link rel="canonical" href="https://www.amazon.com/dp/{asin}" />
          <input id="ASIN" value="{asin}" />
          <span id="productTitle">Soundcore Q20i Wireless Headphones Black</span>
          <div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">$44.99</span></span></div>
          <div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">$49.99</span></span></div>'''
        out=parse_amazon_us_pdp(html,f"https://www.amazon.com/dp/{asin}")
        self.assertIsNone(out[0].price)
        self.assertIn("AMAZON_PDP_MULTIPLE_BUYBOX_PRICES",out[0].issues)

    def test_other_sellers_price_never_becomes_main_buybox(self):
        from nawaa_store_hunter import parse_amazon_us_pdp
        asin="B0C3HCD34R"
        html=f'''<link rel="canonical" href="https://www.amazon.com/dp/{asin}" />
          <input id="ASIN" value="{asin}" />
          <span id="productTitle">Soundcore Q20i Wireless Headphones Black</span>
          <div id="aod-ingress-link"><span class="a-price"><span class="a-offscreen">$11.99</span></span></div>
          <div id="ProductSpecs-1"><span class="a-price"><span class="a-offscreen">$9.00</span></span></div>'''
        out=parse_amazon_us_pdp(html,f"https://www.amazon.com/dp/{asin}")
        self.assertIsNone(out[0].price)
        self.assertIn("AMAZON_PDP_PRIMARY_PRICE_NOT_EVIDENCED",out[0].issues)


class AmazonPdpPerRequestHeaderSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_alternate_pdp_accept_is_one_request_only(self):
        import httpx
        from unittest.mock import patch
        import nawaa_store_hunter as m
        sent=[]
        def handler(req):
            sent.append((req.headers.get("user-agent"),req.headers.get("accept"),
                         req.headers.get("accept-language")))
            return httpx.Response(200,text="<html>public</html>")
        scraper=m.Scraper("https://www.amazon.com","audio",1,1,"never")
        await scraper._client.aclose()
        scraper._client=httpx.AsyncClient(
            transport=httpx.MockTransport(handler),follow_redirects=False,
            headers={"User-Agent":m.USER_AGENT,"Accept":"text/html"})
        with patch.object(m,"ensure_public_url",side_effect=lambda u,origin=None:u), \
             patch.object(scraper,"permitted",return_value=True):
            first=await scraper.fetch(
                "pdp-header-ab","https://www.amazon.com/dp/B0C3HCD34R",
                headers={"Accept":"text/html,application/xhtml+xml",
                         "Accept-Language":"en-US,en;q=0.8"})
            second=await scraper.fetch("product-detail","https://www.amazon.com/dp/B0C3HCD34R")
        await scraper.close()
        self.assertEqual(first,"<html>public</html>")
        self.assertEqual(second,"<html>public</html>")
        self.assertEqual(len(sent),2)
        self.assertEqual([x[0] for x in sent],[m.USER_AGENT,m.USER_AGENT])
        self.assertEqual(sent[0][1],"text/html,application/xhtml+xml")
        self.assertEqual(sent[0][2],"en-US,en;q=0.8")
        self.assertEqual(sent[1][1],"text/html")
        self.assertIsNone(sent[1][2])


class AmazonStorageFormattingParityTests(unittest.TestCase):
    def test_asin_same_storage_gb_spacing_not_false_variant_conflict(self):
        from nawaa_store_hunter import Product, pdp_identity_matches
        asin="B0G4RRVKQS"
        plp=Product(title="Apple iPhone 17 256GB Black",
                    url=f"https://www.amazon.com/dp/{asin}",sku=asin)
        pdp=Product(title="Apple iPhone 17 256 GB Black",
                    url=f"https://www.amazon.com/dp/{asin}",sku=asin,
                    method="amazon-us-pdp-main-buybox",issues=["AMAZON_PDP_ASIN_PROOF"])
        self.assertTrue(pdp_identity_matches(plp,pdp))


class AmazonSelectedAsinPriceProvenanceTests(unittest.IsolatedAsyncioTestCase):
    """A JSON-LD Product offer is not automatically the selected Amazon buybox."""
    async def _run(self, listing_price: bool):
        from unittest.mock import AsyncMock, patch
        import nawaa_store_hunter as m
        asin="B0C3HCD34R"
        title="Soundcore Q20i Wireless Bluetooth Black Headphones"
        price_html='<span class="a-price"><span class="a-offscreen">$44.99</span></span>' if listing_price else ""
        card=(f'<div data-component-type="s-search-result" data-asin="{asin}">'
              f'<h2><a href="/dp/{asin}">{title}</a></h2>'
              '<img class="s-image" src="https://m.media-amazon.com/images/I/main.jpg"/>'
              + price_html + '</div>')
        # This deliberately has a tempting *wrong* price from the PDP schema
        # but the ASIN-verified buybox has no main-offer price at all.
        pdp=(f'<link rel="canonical" href="https://www.amazon.com/dp/{asin}">'
             f'<input id="ASIN" value="{asin}"><span id="productTitle">{title}</span>'
             f'<script type="application/ld+json">{{"@context":"https://schema.org",'
             f'"@type":"Product","name":"{title}","url":"https://www.amazon.com/dp/{asin}",'
             '"offers":{"@type":"Offer","price":"4.99","priceCurrency":"USD"}}</script>'
             '<div id="ProductSpecs-1"><span class="a-price">'
             '<span class="a-offscreen">$4.99</span></span></div>')
        calls=[]
        async def fake_fetch(method,url,params=None,headers=None):
            calls.append(method)
            if method=="homepage": return "<html></html>"
            if method=="search-html": return card
            if method in ("product-detail","product-detail-price-retry"): return pdp
            raise AssertionError(method)
        scraper=m.Scraper("https://www.amazon.com","wireless headphones",1,1,"never","all")
        scraper.prepare=AsyncMock()
        scraper.fetch=fake_fetch
        scraper.search_targets=lambda _:[("https://www.amazon.com/s",{"k":"wireless headphones"})]
        with patch.object(m.asyncio,"sleep",new_callable=AsyncMock):
            result=await scraper.search()
        await scraper.close()
        return result,calls

    async def test_json_ld_wrong_price_cannot_clear_valid_listing_price(self):
        result,calls=await self._run(True)
        p=result["products"][0]
        self.assertEqual(p["price"],"44.99")
        self.assertEqual(p["price_status"],"single_source_unverified")
        self.assertEqual(p["price_source"],"search_only")
        self.assertNotIn("LISTING_PDP_PRICE_CONFLICT",p["issues"])
        self.assertIn("product-detail-price-retry",calls)
        self.assertTrue(any(d["status"]=="PDP_MAIN_PRICE_NOT_EVIDENCED"
                            for d in result["diagnostics"]))

    async def test_json_ld_offer_cannot_invent_missing_listing_price(self):
        result,_=await self._run(False)
        p=result["products"][0]
        self.assertIsNone(p["price"])
        self.assertEqual(p["price_status"],"unresolved")
        self.assertNotEqual(p["price_evidence"],"listing_pdp_agree")


class AmazonSourceAvailabilityStateTests(unittest.IsolatedAsyncioTestCase):
    async def test_three_503s_never_implicate_stock(self):
        import nawaa_store_hunter as m
        scraper=m.Scraper("https://www.amazon.com","ps5 console",1,1,"never")
        for _ in range(3):
            scraper.log("search-html","https://www.amazon.com/s","HTTP_ERROR",detail="503")
        result=scraper.result([],"partial_or_unavailable")
        await scraper.close()
        self.assertEqual(result["source_availability"],"transient_failure")
        self.assertFalse(result["empty_means_out_of_stock"])
        self.assertEqual(result["count"],0)
        self.assertNotEqual(result["status"],"ok")

    async def test_search_success_wins_over_initial_retry_503(self):
        import nawaa_store_hunter as m
        scraper=m.Scraper("https://www.amazon.com","headphones",1,1,"never")
        scraper.log("search-html","https://www.amazon.com/s","HTTP_ERROR",detail="503")
        scraper.log("search-html","https://www.amazon.com/s","OK")
        result=scraper.result([],"partial_or_unavailable")
        await scraper.close()
        self.assertEqual(result["source_availability"],"search_accessible")
        self.assertFalse(result["empty_means_out_of_stock"])

    async def test_robots_error_is_independent_from_stock(self):
        import nawaa_store_hunter as m
        scraper=m.Scraper("https://www.amazon.com","headphones",1,1,"never")
        result=scraper.result([],"robots_unavailable")
        await scraper.close()
        self.assertEqual(result["source_availability"],"robots_unavailable")
        self.assertFalse(result["empty_means_out_of_stock"])


class AmazonPdpFaultContainmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_one_pdp_parser_failure_keeps_second_valid_product(self):
        from unittest.mock import AsyncMock, patch
        import nawaa_store_hunter as m
        one="B0C3HCD34R"
        two="B0CZPLV566"
        titles={one:"Soundcore Q20i Wireless Headphones Black",
                two:"Beats Solo 4 Wireless Headphones Black"}
        def card(asin):
            return (f'<div data-component-type="s-search-result" data-asin="{asin}">'
                    f'<h2><a href="/dp/{asin}">{titles[asin]}</a></h2>'
                    '<span class="a-price"><span class="a-offscreen">$44.99</span></span>'
                    '<img class="s-image" src="https://m.media-amazon.com/images/I/main.jpg" /></div>')
        async def fake_fetch(method,url,params=None,headers=None):
            if method=="homepage":return "<html></html>"
            if method=="search-html":return card(one)+card(two)
            if method=="product-detail":
                asin=url.split("/dp/")[-1]
                return (f'<link rel="canonical" href="https://www.amazon.com/dp/{asin}">'
                        f'<input id="ASIN" value="{asin}">'
                        f'<span id="productTitle">{titles[asin]}</span>'
                        '<div id="corePrice_feature_div"><span class="a-price">'
                        '<span class="a-offscreen">$44.99</span></span></div>')
            if method=="product-detail-price-retry":return None
            raise AssertionError(method)
        original=m.parse_amazon_us_pdp
        def fail_first(html,page):
            if one in page:raise ValueError("synthetic bad HTML for this PDP")
            return original(html,page)
        scraper=m.Scraper("https://www.amazon.com","wireless headphones",2,1,"never","all")
        scraper.prepare=AsyncMock()
        scraper.fetch=fake_fetch
        scraper.search_targets=lambda _:[("https://www.amazon.com/s",{"k":"headphones"})]
        with patch.object(m,"parse_amazon_us_pdp",side_effect=fail_first):
            result=await scraper.search()
        await scraper.close()
        self.assertEqual(result["count"],2)
        by_asin={p["sku"]:p for p in result["products"]}
        self.assertIn("PDP_ENRICHMENT_EXCEPTION",by_asin[one]["issues"])
        self.assertEqual(by_asin[one]["price_source"],"search_only")
        self.assertEqual(by_asin[two]["price_source"],"search_and_pdp_agree")
        self.assertTrue(any(d["status"]=="PDP_ENRICHMENT_EXCEPTION"
                            for d in result["diagnostics"]))

    async def test_cancelled_pdp_is_propagated(self):
        from unittest.mock import AsyncMock
        import nawaa_store_hunter as m
        import asyncio
        asin="B0C3HCD34R"
        title="Soundcore Q20i Wireless Headphones"
        card=f'<div data-component-type="s-search-result" data-asin="{asin}"><h2><a href="/dp/{asin}">{title}</a></h2></div>'
        async def fake_fetch(method,url,params=None,headers=None):
            if method=="homepage":return "<html></html>"
            if method=="search-html":return card
            if method=="product-detail":raise asyncio.CancelledError()
            raise AssertionError(method)
        scraper=m.Scraper("https://www.amazon.com","headphones",1,1,"never","all")
        scraper.prepare=AsyncMock()
        scraper.fetch=fake_fetch
        scraper.search_targets=lambda _:[("https://www.amazon.com/s",{"k":"headphones"})]
        try:
            with self.assertRaises(asyncio.CancelledError):
                await scraper.search()
        finally:
            await scraper.close()


class AmazonPriceProvenanceDedupTests(unittest.IsolatedAsyncioTestCase):
    async def test_duplicate_adopts_pdp_only_price_provenance(self):
        import nawaa_store_hunter as m
        url="https://www.amazon.com/dp/B0C3HCD34R"
        first=m.Product(title="Soundcore Headphones Black",url=url,sku="B0C3HCD34R")
        second=m.Product(title=first.title,url=url,sku=first.sku,price="44.99",
                         currency="USD",price_status="single_source_unverified",
                         price_source="pdp_main_only")
        scraper=m.Scraper("https://www.amazon.com","headphones",2,1,"never")
        merged=scraper.merge([first,second])
        await scraper.close()
        self.assertEqual(len(merged),1)
        self.assertEqual(merged[0].price,"44.99")
        self.assertEqual(merged[0].price_source,"pdp_main_only")

    async def test_duplicate_price_conflict_fails_closed_currency_and_provenance(self):
        import nawaa_store_hunter as m
        url="https://www.amazon.com/dp/B0C3HCD34R"
        first=m.Product(title="Soundcore Headphones Black",url=url,sku="B0C3HCD34R",
                        price="44.99",currency="USD",price_source="search_only")
        second=m.Product(title=first.title,url=url,sku=first.sku,
                         price="49.99",currency="USD",price_source="pdp_main_only")
        scraper=m.Scraper("https://www.amazon.com","headphones",2,1,"never")
        merged=scraper.merge([first,second])
        await scraper.close()
        self.assertEqual(len(merged),1)
        self.assertIsNone(merged[0].price)
        self.assertIsNone(merged[0].currency)
        self.assertEqual(merged[0].price_source,"conflict")
        self.assertIn("SOURCE_PRICE_DISAGREEMENT",merged[0].issues)


class AmazonRequestReductionTests(unittest.IsolatedAsyncioTestCase):
    async def test_successful_robots_policy_reused_between_queries(self):
        from unittest.mock import AsyncMock, patch
        import httpx
        import nawaa_store_hunter as m
        a=m.Scraper("https://www.amazon.com","headphones",1,1,"never")
        b=m.Scraper("https://www.amazon.com","ps5",1,1,"never")
        a._raw_get=AsyncMock(return_value=httpx.Response(
            200,text="User-agent: *\nDisallow: /private\nAllow: /"))
        b._raw_get=AsyncMock(side_effect=AssertionError("robots cache should satisfy this"))
        try:
            with patch.object(m,"_ROBOTS_CACHE",{}), \
                 patch.object(m,"ensure_public_url",side_effect=lambda url,origin=None:url):
                await a.prepare()
                await b.prepare()
                self.assertTrue(b.permitted("https://www.amazon.com/s?k=ps5"))
                self.assertFalse(b.permitted("https://www.amazon.com/private"))
                self.assertEqual(b._raw_get.await_count,0)
                self.assertTrue(any(d.status=="cache_hit" for d in b.diagnostics))
        finally:
            await a.close()
            await b.close()

    async def test_robots_503_is_never_cached_as_allow(self):
        from unittest.mock import AsyncMock, patch
        import httpx
        import nawaa_store_hunter as m
        a=m.Scraper("https://www.amazon.com","headphones",1,1,"never")
        b=m.Scraper("https://www.amazon.com","ps5",1,1,"never")
        a._raw_get=AsyncMock(return_value=httpx.Response(503))
        b._raw_get=AsyncMock(return_value=httpx.Response(
            200,text="User-agent: *\nDisallow: /private\nAllow: /"))
        try:
            with patch.object(m,"_ROBOTS_CACHE",{}), \
                 patch.object(m,"ensure_public_url",side_effect=lambda url,origin=None:url):
                await a.prepare()
                self.assertTrue(a._robots_blocked)
                await b.prepare()
                self.assertEqual(b._raw_get.await_count,1)
                self.assertFalse(b.permitted("https://www.amazon.com/private"))
        finally:
            await a.close()
            await b.close()

    async def test_amazon_explicit_search_skips_homepage_fetch(self):
        from unittest.mock import AsyncMock
        import nawaa_store_hunter as m
        scraper=m.Scraper("https://www.amazon.com","wireless headphones",1,1,"never","none",
                          search_url="https://www.amazon.com/s?k={query}")
        scraper.prepare=AsyncMock()
        calls=[]
        async def fake_fetch(method,url,params=None,headers=None):
            calls.append(method)
            if method=="search-html":return None
            raise AssertionError("unexpected extra source request "+method)
        scraper.fetch=fake_fetch
        scraper.search_targets=lambda _:[("https://www.amazon.com/s",{"k":"wireless headphones"})]
        result=await scraper.search()
        await scraper.close()
        self.assertEqual(calls,["search-html"])
        self.assertEqual(result["count"],0)
