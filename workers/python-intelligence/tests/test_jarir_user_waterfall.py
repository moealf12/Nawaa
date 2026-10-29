"""Direct tests of user's Jarir scraping waterfall, safe no-network fixtures."""
import json
from decimal import Decimal
from unittest.mock import patch
import pytest
from hypothesis import given, strategies as st, settings

from experiments.jarir_user_waterfall import JarirScraperEngine, JarirOfferEvidence

def ld(product: dict)->str:
    return '<html><head><script type="application/ld+json">'+json.dumps(product)+'</script></head><body><h1>iPhone 17</h1></body></html>'

def test_jsonld_matching_sku_price_currency_stock():
    html=ld({"@type":"Product","sku":"666784","name":"iPhone 17 256GB",
        "brand":{"@type":"Brand","name":"Apple"},
        "offers":{"@type":"Offer","sku":"666784","price":"3799.00",
                  "priceCurrency":"SAR","availability":"https://schema.org/InStock"}})
    e=JarirScraperEngine.parse_html(html,JarirOfferEvidence(),expected_sku="666784")
    assert e.sku=="666784" and e.price==Decimal("3799.00")
    assert e.currency=="SAR" and e.availability=="IN_STOCK"
    assert e.field_evidence["price"].source=="JSON-LD"
    # Fix for provided code's model_dump()->json.dumps(Decimal) failure
    assert json.loads(json.dumps(e.model_dump(mode="json")))["price"]=="3799.00"

def test_wrong_sku_must_not_inherit_price():
    html=ld({"@type":"Product","sku":"OTHER","name":"iPhone 17 512GB",
        "offers":{"@type":"Offer","price":"2799.00","priceCurrency":"SAR"}})
    e=JarirScraperEngine.parse_html(html,JarirOfferEvidence(),expected_sku="666784")
    assert e.price is None
    assert "EXPECTED_SKU_NOT_FOUND" in e.issues

def test_aggregate_offer_and_multioffer_not_first_price():
    product={"@type":"Product","sku":"666784","name":"iPhone 17"}
    a=JarirScraperEngine.parse_html(ld({
       **product,"offers":{"@type":"AggregateOffer","lowPrice":"899","price":"899","priceCurrency":"SAR"}
    }),JarirOfferEvidence(),"666784")
    assert a.price is None and "AGGREGATE_PRICE_NOT_SELLABLE" in a.issues
    b=JarirScraperEngine.parse_html(ld({
       **product,"offers":[{"price":"3999","priceCurrency":"SAR"},
                             {"price":"3799","priceCurrency":"SAR"}]
    }),JarirOfferEvidence(),"666784")
    assert b.price is None and "MULTIPLE_OFFERS_AMBIGUOUS" in b.issues

def test_currency_mismatch_has_no_price():
    e=JarirScraperEngine.parse_html(ld({
        "@type":"Product","sku":"666784",
        "offers":{"@type":"Offer","price":"10.99","priceCurrency":"AED"}
    }),JarirOfferEvidence(),"666784")
    assert e.price is None and e.currency is None
    assert "JSONLD_CURRENCY_UNVERIFIED" in e.issues

def test_hydration_fallback_same_sku_only():
    payload={"props":{"pageProps":{"product":{
        "sku":"666784","name":"Apple iPhone 17","price":"3799",
        "currency":"SAR","is_in_stock":True
    }}}}
    html="<html><head><script id='__NEXT_DATA__' type='application/json'>"+json.dumps(payload)+"</script></head></html>"
    good=JarirScraperEngine.parse_html(html,JarirOfferEvidence(),"666784")
    assert good.price==Decimal("3799") and good.availability=="IN_STOCK"
    assert good.field_evidence["price"].source=="Hydration"
    bad=JarirScraperEngine.parse_html(html,JarirOfferEvidence(),"OTHER")
    assert bad.price is None and "HYDRATION_EXPECTED_SKU_MISMATCH" in bad.issues

def test_dom_title_no_unowned_price():
    html='<h1>iPhone 17 Pro 512GB</h1><span class="price-value">999 SAR</span>'
    e=JarirScraperEngine.parse_html(html,JarirOfferEvidence(),"666784")
    assert e.product_title=="iPhone 17 Pro 512GB"
    assert e.price is None and "DOM_PRICE_UNBOUND_TO_SKU" in e.issues

def test_jsonld_graph_products_ambiguous():
    content={'@graph':[
        {'@type':'Product','sku':'666784','name':'iPhone 17 A',
         'offers':{'price':'100','priceCurrency':'SAR'}},
        {'@type':'Product','sku':'777777','name':'iPhone 17 B',
         'offers':{'price':'150','priceCurrency':'SAR'}},
    ]}
    e=JarirScraperEngine.parse_html(ld(content),JarirOfferEvidence())
    assert e.price is None and "MULTIPLE_PRODUCT_NODES" in e.issues
    x=JarirScraperEngine.parse_html(ld(content),JarirOfferEvidence(),"666784")
    assert x.price==Decimal("100")

def test_mocked_fetch_and_hash():
    html=ld({"@type":"Product","sku":"666784","name":"iPhone 17",
             "offers":{"price":"3799","priceCurrency":"SAR"}})
    with patch.object(JarirScraperEngine,"_download",return_value=(html,"https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html")):
        e=JarirScraperEngine.extract_jarir_product("https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html","666784")
    assert e.response_sha256 and len(e.response_sha256)==64
    assert e.fetched_at and e.price==Decimal("3799")

def test_malformed_inputs_fail_closed():
    for url in ("http://www.jarir.com/p","https://127.0.0.1","https://www.jarir.com.evil.invalid/p","https://example.org/p"):
        with pytest.raises(ValueError):
            JarirScraperEngine._safe_url(url)
    assert JarirScraperEngine._safe_url("https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html")

@given(value=st.sampled_from(["0","-2","NaN","Infinity","0.00","-0.1"]))
@settings(max_examples=15)
def test_property_invalid_prices_are_never_exported(value):
    e=JarirScraperEngine.parse_html(ld({"@type":"Product","sku":"666784",
        "offers":{"price":value,"priceCurrency":"SAR"}}),JarirOfferEvidence(),"666784")
    assert e.price is None

@given(sku=st.text(alphabet="ABC123xyz",min_size=1,max_size=10).filter(lambda x:x!="666784"))
@settings(max_examples=45)
def test_property_other_sku_never_accepted(sku):
    html=ld({"@type":"Product","sku":sku,"name":"iPhone 17",
             "offers":{"price":"100","priceCurrency":"SAR"}})
    e=JarirScraperEngine.parse_html(html,JarirOfferEvidence(),"666784")
    assert e.price is None
