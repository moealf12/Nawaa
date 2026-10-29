"""eXtra Python extraction acceptance tests against controlled offline evidence."""
import io
import json
import subprocess
import sys
from decimal import Decimal

import httpx
import pytest
from hypothesis import given, settings, strategies as st

from nawaa_py.extra_pdp import (
    ExtraScraperEngine, ExtraFetchError, ExtraOfferEvidence, EvidenceTrace,
    approved_url, _price, _availability, process, SOURCE_ID, SCHEMA_VERSION
)

URL = ("https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/"
       "apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492")
SKU = "100462492"

def html(product):
    return ('<html><head><script type="application/ld+json">'
            + json.dumps(product, ensure_ascii=False)
            + '</script></head></html>')

def product(price="4299.00", sku=SKU, currency="SAR", **changes):
    obj = {
        "@context": "https://schema.org", "@type": "Product",
        "name": "Apple iPhone 17e 512GB Soft Pink",
        "sku": sku, "brand": {"@type": "Brand", "name": "Apple"},
        "offers": {
            "@type": "Offer", "price": price,
            "priceCurrency": currency,
            "availability": "https://schema.org/InStock",
        },
    }
    obj.update(changes)
    return obj

def parse(value, requested_url=None):
    return ExtraScraperEngine.parse_html(html(value), SKU, requested_url=requested_url)

def test_jsonld_exact_sku_decimal_price_and_availability():
    e = parse(product(), URL)
    assert e.sku == SKU
    assert e.price == Decimal("4299.00")
    assert e.currency == "SAR"
    assert e.availability == "IN_STOCK"
    assert e.brand == "Apple"
    assert e.field_evidence["price"].source == "JSON-LD"
    assert e.field_evidence["sku"].source == "JSON-LD"
    assert e.issues == []
    data = e.model_dump(mode="json")
    assert data["price"] == "4299.00"
    assert data["response_sha256"] is None
    assert "verified" not in data

def test_jsonld_graph_and_array_parsing():
    graph = {"@context": "https://schema.org", "@graph": [
        {"@type": "BreadcrumbList", "name": "crumb"},
        product()
    ]}
    e = parse(graph)
    assert e.price == Decimal("4299.00")
    assert e.sku == SKU
    e = parse([{"@type": "WebPage", "name": "page"}, product()])
    assert e.price == Decimal("4299.00")

def test_reject_wrong_sku_even_if_price_says_sar():
    e = parse(product(sku="100462493"))
    assert e.price is None
    assert e.currency is None
    assert "PRODUCT_SKU_MISMATCH" in e.issues

def test_reject_missing_sku():
    obj = product()
    del obj["sku"]
    e = parse(obj)
    assert e.price is None
    assert "SKU_EVIDENCE_MISSING" in e.issues

def test_reject_aggregate_lowprice_and_not_fake_offer():
    obj = product()
    obj["offers"] = {"@type": "AggregateOffer", "lowPrice": "3999", "priceCurrency": "SAR"}
    e = parse(obj)
    assert e.price is None
    assert "AGGREGATE_OFFER_NOT_SELLABLE" in e.issues

def test_reject_multiple_offers_not_bound_to_exact_sku():
    obj = product()
    obj["offers"] = [
        {"@type": "Offer", "price": "3900", "priceCurrency": "SAR"},
        {"@type": "Offer", "price": "4900", "priceCurrency": "SAR"},
    ]
    e = parse(obj)
    assert e.price is None
    assert "MULTIPLE_OFFERS_AMBIGUOUS" in e.issues

def test_select_unique_matching_sku_offer_from_multiple():
    obj = product()
    obj["offers"] = [
        {"@type": "Offer", "sku": "100462493", "price": "3000", "priceCurrency": "SAR"},
        {"@type": "Offer", "sku": SKU, "price": "4299.00", "priceCurrency": "SAR"},
    ]
    e = parse(obj)
    assert e.price == Decimal("4299.00")

def test_reject_single_offer_sku_conflict():
    obj = product()
    obj["offers"]["sku"] = "100462493"
    e = parse(obj)
    assert e.price is None
    assert "OFFER_SKU_MISMATCH" in e.issues

def test_reject_multiple_matching_variant_nodes():
    e = parse({"@graph": [product(), product()]})
    assert e.price is None
    assert "MULTIPLE_SAME_SKU_PRODUCTS" in e.issues

def test_missing_currency_never_defaults_to_sar():
    e = parse(product(currency=None))
    assert e.price is None
    assert e.currency is None
    assert "JSONLD_CURRENCY_MISSING_OR_NOT_SAR" in e.issues

def test_wrong_currency_never_becomes_sar():
    e = parse(product(currency="AED"))
    assert e.price is None

def test_fallback_dom_requires_sku_attestation_and_explicit_currency():
    obj = product()
    obj["offers"] = {"@type": "Offer", "priceCurrency": "SAR"}
    markup = html(obj).replace("</html>",
        '<h1>Apple iPhone 17e 512GB</h1>'
        '<div class="current-price">SAR 4,299.00</div></html>')
    e = ExtraScraperEngine.parse_html(markup, SKU)
    assert e.price == Decimal("4299.00")
    assert e.field_evidence["price"].source == "DOM"
    assert e.field_evidence["currency"].source == "DOM"
    markup2 = markup.replace("SAR 4,299.00", "4,299.00")
    e2 = ExtraScraperEngine.parse_html(markup2, SKU)
    assert e2.price is None
    assert e2.currency is None

def test_dom_cannot_override_conflicting_product_sku():
    markup = html(product(sku="100462493")).replace(
        "</html>", '<div class="current-price">SAR 999.00</div></html>')
    e = ExtraScraperEngine.parse_html(markup, SKU)
    assert e.price is None

def test_no_product_node_or_arbitrary_price():
    e = ExtraScraperEngine.parse_html(
        '<h1>Something else</h1><div class="current-price">SAR 1,200</div>', SKU
    )
    assert e.price is None
    assert "PRODUCT_JSONLD_NOT_FOUND" in e.issues

def test_strict_decimal_money_and_no_malformed_numbers():
    for v in ("0", "-1", "NaN", "Infinity", "1e9", "3,50", "999.999", "1000foo", ""):
        assert _price(v) is None
    assert _price("4,299.00") == Decimal("4299.00")
    assert _price("4299.00") == Decimal("4299.00")
    assert _price(42.55) is None  # reject float input

def test_availability_exact():
    assert _availability("https://schema.org/InStock") == "IN_STOCK"
    assert _availability("https://schema.org/OutOfStock") == "OUT_OF_STOCK"
    assert _availability("https://schema.org/PreOrder") == "PREORDER"
    assert _availability("CustomInStockSomething") == "UNKNOWN"

def test_ssrf_and_sku_url_allowlist():
    assert approved_url(URL, SKU)
    for u, sku in [
        (URL, "100462493"),
        (URL + "?tracking=1", SKU),
        (URL + "#view", SKU),
        ("http://www.extra.com/en-sa/mobile/p/" + SKU, SKU),
        ("https://www.extra.com.evil.test/en-sa/mobile/p/" + SKU, SKU),
        ("https://localhost/en-sa/mobile/p/" + SKU, SKU),
        ("https://127.0.0.1/en-sa/mobile/p/" + SKU, SKU),
        ("https://user@www.extra.com/en-sa/mobile/p/" + SKU, SKU),
        ("https://www.extra.com/en-sa/search?q=iphone", SKU),
    ]:
        assert not approved_url(u, sku), u

def test_pydantic_strict_contract():
    base = {"schemaVersion": SCHEMA_VERSION, "requestId": "unit-1",
            "sourceId": SOURCE_ID, "url": URL, "expected_sku": SKU}
    from nawaa_py.extra_pdp import ExtraRequest
    assert ExtraRequest.model_validate(base).requestId == "unit-1"
    for update in ({"unexpected": 1}, {"expected_sku": 100462492},
                   {"schemaVersion": "wrong"}, {"sourceId": "jarir-sa"}):
        with pytest.raises(ValueError):
            ExtraRequest.model_validate({**base, **update})

def test_httpx_mock_403_not_bypassed(monkeypatch):
    monkeypatch.setattr(ExtraScraperEngine, "_public_dns", lambda: None)
    requests = []
    def handler(req):
        requests.append(str(req.url))
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /\n",
                                  headers={"Content-Type": "text/plain"})
        return httpx.Response(403, text="Forbidden")
    original = httpx.Client
    monkeypatch.setattr(httpx, "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(ExtraFetchError) as caught:
        ExtraScraperEngine.extract_product(URL, SKU)
    assert caught.value.code == "HTTP_403"
    assert caught.value.http_status == 403
    assert len(requests) == 2
    assert requests[-1] == URL

def test_httpx_mock_robots_disallow_never_fetches_product(monkeypatch):
    monkeypatch.setattr(ExtraScraperEngine, "_public_dns", lambda: None)
    requests = []
    def handler(req):
        requests.append(str(req.url))
        return httpx.Response(200, text="User-agent: *\nDisallow: /\n",
                              headers={"Content-Type": "text/plain"})
    original = httpx.Client
    monkeypatch.setattr(httpx, "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(ExtraFetchError) as caught:
        ExtraScraperEngine.extract_product(URL, SKU)
    assert caught.value.code == "ROBOTS_DISALLOW"
    assert requests == ["https://www.extra.com/robots.txt"]

def test_httpx_mock_real_html_fetch_and_checksum(monkeypatch):
    monkeypatch.setattr(ExtraScraperEngine, "_public_dns", lambda: None)
    body = html(product()).encode()
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /\n",
                                  headers={"Content-Type": "text/plain"})
        return httpx.Response(200, content=body, headers={"Content-Type": "text/html"})
    original = httpx.Client
    monkeypatch.setattr(httpx, "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    e = ExtraScraperEngine.extract_product(URL, SKU)
    import hashlib
    assert e.response_sha256 == hashlib.sha256(body).hexdigest()
    assert e.price == Decimal("4299.00")
    assert e.final_url == URL

def test_httpx_mock_redirect_not_followed(monkeypatch):
    monkeypatch.setattr(ExtraScraperEngine, "_public_dns", lambda: None)
    def handler(req):
        if req.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /\n")
        return httpx.Response(302, headers={"Location": "https://example.com/"})
    original = httpx.Client
    monkeypatch.setattr(httpx, "Client",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    with pytest.raises(ExtraFetchError, match="REDIRECT_NOT_FOLLOWED"):
        ExtraScraperEngine.extract_product(URL, SKU)

@given(s=st.text(min_size=1,max_size=50))
@settings(max_examples=45, deadline=None)
def test_hypothesis_noise_never_makes_currency_or_sku(s):
    markup = ('<html><h1>' + s + '</h1><div class="current-price">SAR 999.00</div></html>')
    e = ExtraScraperEngine.parse_html(markup, SKU)
    assert e.price is None

@given(value=st.one_of(st.floats(allow_nan=True,allow_infinity=True),
                       st.booleans(),st.none()))
@settings(max_examples=40,deadline=None)
def test_hypothesis_non_decimal_evidence_never_accepted(value):
    assert _price(value) is None
