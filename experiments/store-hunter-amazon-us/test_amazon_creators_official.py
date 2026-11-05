"""Deterministic tests for opt-in official Amazon Creators API adapter.

MockTransport is the only transport; no actual credentials or API traffic.
"""
import unittest
import httpx
from amazon_creators_official import CreatorsAPI, Config, parse_featured_offers


def payload(asin="B0C3HCD34R", price=44.99, currency="USD", winners=1):
    return {
        "itemsResult": {"items": [{
            "asin": asin,
            "detailPageURL": "https://www.amazon.com/dp/" + asin,
            "itemInfo": {"title": {"displayValue": "Soundcore Q20i Wireless Headphones"}},
            "images": {"primary": {"large": {"url": "https://m.media-amazon.com/images/I/example.jpg"}}},
            "offersV2": {"listings": [
                {"isBuyBoxWinner": True, "price": {"money": {"amount": price, "currency": currency}},
                 "availability": {"type": "IN_STOCK"}, "condition": {"value": "New"}}
                for _ in range(winners)
            ] + [
                {"isBuyBoxWinner": False,
                 "price": {"money": {"amount": 1.99, "currency": "USD"}}}
            ]},
        }]},
    }


class CreatorsFeaturedOfferIntegrityTests(unittest.TestCase):
    def test_only_same_asin_one_featured_offer_with_explicit_usd(self):
        result = parse_featured_offers(payload(), ["B0C3HCD34R"])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["price"], "44.99")
        self.assertEqual(result[0]["price_source"], "amazon_creators_api_featured_offer")
        self.assertEqual(result[0]["availability"], "IN_STOCK")
        self.assertEqual(result[0]["condition"], "New")
        self.assertNotIn("seller", result[0])
        self.assertNotIn("shipping", result[0])

    def test_wrong_asin_never_borrows_offer(self):
        self.assertEqual(parse_featured_offers(payload(), ["B0FQFB8FMG"]), [])

    def test_two_featured_offers_ambiguous_no_price(self):
        self.assertEqual(parse_featured_offers(payload(winners=2), ["B0C3HCD34R"]), [])

    def test_currency_must_be_explicit_usd(self):
        self.assertEqual(parse_featured_offers(payload(currency="EUR"), ["B0C3HCD34R"]), [])

    def test_offer_saving_basis_is_not_buying_price(self):
        candidate = payload()
        entry = candidate["itemsResult"]["items"][0]["offersV2"]["listings"][0]
        entry["price"] = {"savingBasis": {"money": {"amount": 44.99, "currency": "USD"}}}
        self.assertEqual(parse_featured_offers(candidate, ["B0C3HCD34R"]), [])

    def test_zero_and_invalid_price_rejected(self):
        for value in (0, -1.0, "NaN", "Infinity", "garbage"):
            with self.subTest(value=value):
                self.assertEqual(parse_featured_offers(payload(price=value), ["B0C3HCD34R"]), [])


class CreatorsAPITransportSafetyTests(unittest.IsolatedAsyncioTestCase):
    async def test_no_credentials_performs_zero_requests(self):
        calls=[]
        def handler(request):
            calls.append(str(request.url))
            return httpx.Response(500)
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        api=CreatorsAPI(None, client=client)
        try:
            result=await api.get_items(["B0C3HCD34R"])
            self.assertEqual(result["state"],"not_configured")
            self.assertEqual(calls,[])
        finally:
            await api.close()
            await client.aclose()

    async def test_valid_token_and_featured_offer_no_secret_logging(self):
        seen=[]
        def handler(request):
            seen.append((request.url.host,request.url.path,request.headers.get("authorization")))
            if request.url.path.endswith("/token"):
                return httpx.Response(200,json={"access_token":"SYNTHETIC_UNIT_TOKEN",
                                               "expires_in":3600})
            if request.url.path.endswith("/getItems"):
                self.assertEqual(request.headers.get("x-marketplace"),"www.amazon.com")
                self.assertEqual(request.headers.get("authorization"),"Bearer SYNTHETIC_UNIT_TOKEN")
                return httpx.Response(200,json=payload())
            raise AssertionError(str(request.url))
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        api=CreatorsAPI(Config("unit-id","unit-secret","unit-20"),client=client)
        try:
            result=await api.get_items(["B0C3HCD34R"])
            self.assertEqual(result["state"],"ok")
            self.assertEqual(result["offers"][0]["price"],"44.99")
            self.assertEqual(len(seen),2)
            self.assertNotIn("unit-secret",str(result))
            self.assertNotIn("SYNTHETIC_UNIT_TOKEN",str(result))
        finally:
            await api.close()
            await client.aclose()

    async def test_upstream_503_is_not_out_of_stock(self):
        def handler(request):
            if request.url.path.endswith("/token"):
                return httpx.Response(200,json={"access_token":"test","expires_in":3600})
            return httpx.Response(503)
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        api=CreatorsAPI(Config("id","secret","unit-20"),client=client)
        try:
            result=await api.get_items(["B0C3HCD34R"])
            self.assertEqual(result,{"state":"temporarily_unavailable","offers":[]})
        finally:
            await api.close()
            await client.aclose()

    async def test_invalid_11_item_batch_fails_before_http(self):
        calls=[]
        def handler(request):
            calls.append(request)
            return httpx.Response(200,json={})
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        api=CreatorsAPI(Config("id","secret","unit-20"),client=client)
        try:
            result=await api.get_items(["B0FQFB8FMG"]*2 + [f"B{n:09d}" for n in range(11)])
            self.assertEqual(result["state"],"invalid_asin_batch")
            self.assertEqual(calls,[])
        finally:
            await api.close()
            await client.aclose()
