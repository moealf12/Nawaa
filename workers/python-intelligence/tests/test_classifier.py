"""Direct Python tests; no JavaScript scraper comparisons or merchant bypass."""
import asyncio
import json
from decimal import Decimal
import pytest
import httpx
from hypothesis import given, settings, strategies as st

from nawaa_py.contracts import ProductExpectation, ExtractionRequest, VERSION
from nawaa_py.cli import process
from nawaa_py.variants import VariantClassifier
from nawaa_py.normalize import norm, storage_from_title
from nawaa_py.prices import parse_price
from nawaa_py.html_extract import extract_html
from nawaa_py.transport import validate_url, FetchFailure, _bounded_get, fetch_public_html

def item(**kwargs):
    return ProductExpectation.model_validate(kwargs)

def test_model_suffix_cross_contamination():
    for expected, actual in [
        ("Garmin Edge 540", "Garmin Edge 540 Solar"),
        ("iPhone 17", "iPhone 17 Pro"),
        ("iPhone 17 Pro", "iPhone 17 Pro Max"),
        ("PS5 Digital", "PS5 Disc"),
        ("Galaxy S25", "Galaxy S25 Ultra"),
        ("Edge 540", "Edge 540 Bundle"),
    ]:
        result=VariantClassifier.classify(item(model=expected),item(model=actual))
        assert result.decision=="REJECT", (expected,actual,result)
        assert result.similarityScore is not None

def test_missing_is_not_candidate():
    result=VariantClassifier.classify(item(model="iPhone 17",storageGb=256),
                                      item(model="iPhone 17"))
    assert result.decision=="INSUFFICIENT_EVIDENCE"
    assert "storageGb" in result.missing
    assert VariantClassifier.classify(item(),item()).decision=="INSUFFICIENT_EVIDENCE"

def test_brand_storage_condition_sku_bundle():
    base=item(brand="Apple", model="iPhone 17",storageGb=256,
              condition="NEW",sku="SKU-X",bundleId="base")
    for changes in ({"brand":"Samsung"},{"storageGb":128},
                    {"condition":"REFURBISHED"},{"sku":"SKU-Y"},{"bundleId":"with-controller"}):
        observed=base.model_copy(update=changes)
        assert VariantClassifier.classify(base,observed).decision=="REJECT"

def test_normalization_stays_deterministic():
    assert norm("iPhone-17 PRO") == norm("iPhone 17 pro")
    assert storage_from_title("iPhone 17 1TB") == 1024
    assert storage_from_title("128GB and 256GB") is None
    assert storage_from_title("5G phone") is None

def test_price_evidence():
    p=parse_price("3299.90","SAR","IN_STOCK")
    assert p.price == Decimal("3299.90")
    assert p.currency=="SAR"
    for value in ("0","-5","NaN","Infinity","1e5","1,599","10.999",""):
        with pytest.raises(ValueError):
            parse_price(value,"SAR")
    with pytest.raises(ValueError):
        parse_price("100",None)

GOOD_HTML='''<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product",
 "name":"Garmin Edge 540 Solar 32GB",
 "brand":{"@type":"Brand","name":"Garmin"},"model":"Edge 540 Solar",
 "sku":"G-540-S","offers":{"@type":"Offer","price":"1599.00",
 "priceCurrency":"SAR","availability":"https://schema.org/InStock"}}
</script></head></html>'''

def test_real_python_bs4_lxml_extraction():
    product,offer,code=extract_html(GOOD_HTML,item(model="Edge 540 Solar"))
    assert code=="STRUCTURED_OFFER_EXTRACTED"
    assert product.model=="Edge 540 Solar"
    assert product.storageGb==32
    assert product.sku=="G-540-S"
    assert offer.price == Decimal("1599.00")
    assert offer.availability=="IN_STOCK"
    mismatch=VariantClassifier.classify(item(model="Edge 540"),product)
    assert mismatch.decision=="REJECT"

def test_graph_and_no_fabricated_prices():
    graph='<script type="application/ld+json">'+json.dumps({
      "@graph":[{"@type":"BreadcrumbList","name":"crumb"},
                {"@type":"Product","name":"iPhone 17 256GB",
                 "model":"iPhone 17","brand":"Apple",
                 "offers":{"@type":"Offer","priceCurrency":"SAR"}}]
    })+'</script>'
    product,offer,reason=extract_html(graph,item(model="iPhone 17"))
    assert product.model=="iPhone 17"
    assert offer is None
    assert reason=="PRICE_NOT_FOUND"
    product,offer,reason=extract_html("<div>no data</div>",item())
    assert product is None and offer is None

def test_multi_offer_or_variant_ambiguity():
    html='<script type="application/ld+json">'+json.dumps({
       "@type":"Product","name":"Edge 540",
       "offers":[{"@type":"Offer","sku":"BASE","price":"1000","priceCurrency":"SAR"},
                 {"@type":"Offer","sku":"SOLAR","price":"1200","priceCurrency":"SAR"}]
    })+'</script>'
    _,offer,reason=extract_html(html,item(model="Edge 540"))
    assert offer is None and reason=="MULTIPLE_OFFERS_AMBIGUOUS"
    _,offer,reason=extract_html(html,item(sku="SOLAR"))
    assert offer.price == Decimal("1200")

def test_no_cross_sku_price_enrichment():
    mismatch='<script type="application/ld+json">'+json.dumps({
        "@type":"Product","name":"Garmin Edge 540",
        "model":"Edge 540","sku":"EDGE-540",
        "offers":{"@type":"Offer","sku":"EDGE-540-SOLAR",
                  "price":"1599.00","priceCurrency":"SAR"}
    })+'</script>'
    product,offer,reason=extract_html(mismatch,item(model="Edge 540"))
    assert product.sku=="EDGE-540"
    assert offer is None and reason=="OFFER_PRODUCT_SKU_MISMATCH"
    mismatch2='<script type="application/ld+json">'+json.dumps({
        "@type":"Product","name":"Edge 540", "model":"Edge 540",
        "offers":{"@type":"Offer","sku":"OTHER-SKU",
                  "price":"1500","priceCurrency":"SAR"}
    })+'</script>'
    _,offer,reason=extract_html(mismatch2,item(model="Edge 540",sku="EXPECTED-SKU"))
    assert offer is None and reason=="OFFER_EXPECTED_SKU_MISMATCH"

def test_pydantic_strict_schema_and_unknown_fields():
    raw={"schemaVersion":VERSION,"requestId":"t1","sourceId":"jarir-sa",
         "operation":"extract_html",
         "input":{"html":GOOD_HTML,"expected":{"model":"Edge 540 Solar"}}}
    request=ExtractionRequest.model_validate(raw)
    assert request.input_data.expected.model=="Edge 540 Solar"
    with pytest.raises(ValueError):
        ExtractionRequest.model_validate({**raw,"unexpected":True})
    with pytest.raises(ValueError):
        ExtractionRequest.model_validate({**raw,"input":{"html":GOOD_HTML,"expected":{"storageGb":"256"}}})
    with pytest.raises(ValueError):
        ExtractionRequest.model_validate({**raw,"input":{"url":"https://www.jarir.com/sa-en/","html":GOOD_HTML}})

def test_cli_async_json_contract_and_no_dummy_price():
    raw={"schemaVersion":VERSION,"requestId":"trial-1","sourceId":"jarir-sa",
         "operation":"extract_and_classify",
         "input":{"html":GOOD_HTML,"expected":{"model":"Edge 540"}}}
    output=asyncio.run(process(raw))
    assert output["status"]=="EXTRACTED"
    assert output["identity"]["decision"]=="REJECT"
    assert output["offerEvidence"]["price"]=="1599.00"
    raw["input"]["html"]="<html>Unpriced</html>"
    output=asyncio.run(process(raw))
    assert output["status"]=="NO_OFFER"
    assert output["offerEvidence"] is None

def test_network_access_disabled_by_default(monkeypatch):
    monkeypatch.delenv("NAWAA_PY_LIVE_ENABLED",raising=False)
    with pytest.raises(FetchFailure,match="NETWORK_DISABLED"):
        asyncio.run(fetch_public_html("https://www.jarir.com/sa-en/","jarir-sa",2000,100000))

def test_ssrf_allowlist_and_invalid_protocol():
    for url,source in [
        ("http://www.jarir.com/sa-en/","jarir-sa"),
        ("https://localhost/private","jarir-sa"),
        ("https://127.0.0.1/","jarir-sa"),
        ("https://www.jarir.com.evil.test/","jarir-sa"),
        ("https://user:pass@www.jarir.com/","jarir-sa"),
        ("https://www.jarir.com/sa-en/","noon-sa")
    ]:
        with pytest.raises(FetchFailure):
            validate_url(url,source)
    assert validate_url("https://www.jarir.com/sa-en/","jarir-sa").startswith("https://")

def test_httpx_test_transport_rejects_redirect_and_403():
    async def scenario():
        for code in (301,403,429,500):
            async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda request: httpx.Response(code))) as client:
                with pytest.raises(FetchFailure):
                    await _bounded_get(client,"https://www.jarir.com/",1024)
        async with httpx.AsyncClient(transport=httpx.MockTransport(
            lambda request:httpx.Response(200,content=b"x"*2048))) as client:
            with pytest.raises(FetchFailure,match="RESPONSE_TOO_LARGE"):
                await _bounded_get(client,"https://www.jarir.com/",128)
    asyncio.run(scenario())

@given(a=st.integers(min_value=1,max_value=4096),
       b=st.integers(min_value=1,max_value=4096).filter(lambda v:v!=256))
@settings(max_examples=70,deadline=None)
def test_hypothesis_storage_invariant(a,b):
    if a==b:
        return
    expected=item(model="iPhone 17",storageGb=a)
    observed=item(model="iPhone 17",storageGb=b)
    assert VariantClassifier.classify(expected,observed).decision=="REJECT"

@given(suffix=st.sampled_from(["Pro","Pro Max","Solar","Plus","Digital","Disc","Bundle"]))
@settings(max_examples=35,deadline=None)
def test_hypothesis_suffix_never_fuzzy_promotes(suffix):
    a=item(model="Edge 540")
    b=item(model="Edge 540 "+suffix)
    result=VariantClassifier.classify(a,b)
    assert result.decision=="REJECT"

@given(gibberish=st.text(min_size=1,max_size=150))
@settings(max_examples=40,deadline=None)
def test_hypothesis_arbitrary_text_cannot_create_price(gibberish):
    html="<body>"+gibberish+"</body>"
    _,offer,_=extract_html(html,item(model="PS5"))
    assert offer is None
