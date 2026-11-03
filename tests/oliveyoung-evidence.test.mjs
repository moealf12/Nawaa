import test from "node:test";
import assert from "node:assert/strict";
import {
  oliveYoungSearchUrl,oliveYoungProductIdentity,parseOliveYoungUSD,
  observeOliveYoungSearch,observeOliveYoungPdp,
} from "../src/oliveyoung-evidence.mjs";
import {oliveYoungLiveConfigured,evaluateOliveYoungSearch,
  verifyOliveYoungKnownProduct} from "../server/providers/oliveyoung-live.mjs";
import {NAWAA_INDEXER_USER_AGENT,merchantRequestHeaders}
  from "../src/source-http-profile.mjs";
import {searchFreeStorefrontById,configuredFreeStorefronts,
  routeFreeStorefronts} from "../server/providers/free-storefronts.mjs";

const query="sunscreen",searchUrl=oliveYoungSearchUrl(query);
const productId="GA220113365",pdpUrl=
  "https://global.oliveyoung.com/product/detail?prdtNo="+productId;
const name="SKIN1004 Madagascar Centella Hyalu-Cica Brightening Toner 210mL";
function searchPage({q=query,count="1,301",title="Search | OLIVE YOUNG Global"}={}){
  return '<html><head><title>'+title+'</title></head><body>'+
    '<main><h1>Results for '+String.fromCharCode(39)+q+String.fromCharCode(39)+'</h1>'+
    '<div>'+count+'items</div><aside>Price US$1.5 ~ US$76</aside>'+
    '<a href="/global/category/1000000011">Suncare</a></main></body></html>';
}
function pdp({price="US$16.20",was="US$18.00",cart="Add to Cart - US$16.20",
  title=name,destination="Global (Select Location)",buttonDisabled=false}={}){
  return '<html><head><title>'+title+' | OLIVE YOUNG Global</title></head>'+
    '<body class="detail-page"><div class="prd-detail-content">'+
    '<div class="prd-detail-title"><dt data-testid="product-name">'+title+'</dt></div>'+
    '<div class="prd-price-info"><dl><dt class="price"><div>'+
    '<span class="notranslate">'+was+'</span></div></dt>'+
    '<dd data-testid="product-price" class="sale-price"><span>'+price+'</span></dd>'+
    '</dl></div><button data-testid="product-delivery-country-button">'+
    'Deliver to <span class="notranslate">'+destination+'</span></button>'+
    '<button data-testid="product-addtocart-button"'+
    (buttonDisabled?' disabled':'')+'><span>'+cart+'</span></button>'+
    '</div><aside class="recommended"><strong>US$8.99</strong></aside></body></html>';
}
const search=(html,overrides={})=>observeOliveYoungSearch(html,
  {query,requestedUrl:searchUrl,finalUrl:searchUrl,...overrides});
const product=(html,overrides={})=>observeOliveYoungPdp(html,
  {requestedUrl:pdpUrl,finalUrl:pdpUrl,
    observedAt:"2026-11-04T00:00:00.000Z",...overrides});

test("builds a general-query official results URL, with Arabic and punctuation",()=>{
  assert.equal(new URL(searchUrl).pathname,"/global/search/results");
  assert.equal(new URL(oliveYoungSearchUrl("فستان")).searchParams.get("query"),"فستان");
  assert.equal(new URL(oliveYoungSearchUrl("cica + serum")).searchParams.get("query"),"cica + serum");
  assert.throws(()=>oliveYoungSearchUrl(" "),/INVALID_QUERY/);
  assert.throws(()=>oliveYoungSearchUrl("a".repeat(161)),/INVALID_QUERY/);
});
test("first-party exact product ID validation rejects external hosts and unexpected tracking keys",()=>{
  assert.equal(oliveYoungProductIdentity(pdpUrl).productId,productId);
  assert.equal(oliveYoungProductIdentity(pdpUrl+"&accParam=150").sourceUrl,pdpUrl);
  for(const url of [
    "http://global.oliveyoung.com/product/detail?prdtNo="+productId,
    "https://evil.test/product/detail?prdtNo="+productId,
    "https://global.oliveyoung.com.evil.test/product/detail?prdtNo="+productId,
    "https://global.oliveyoung.com/product/detail?prdtNo=INVALID",
    pdpUrl+"&redirect=https://evil.test",
  ])assert.equal(oliveYoungProductIdentity(url),null,url);
});
test("USD parser rejects invalid, implied, zero or mixed currencies",()=>{
  assert.equal(parseOliveYoungUSD("US$16.20"),16.2);
  assert.equal(parseOliveYoungUSD("US$1,200.55"),1200.55);
  for(const s of ["$16.20","SAR 16.20","16.20","US$0.00","US$16.2","US$1.200,55"])
    assert.equal(parseOliveYoungUSD(s),null,s);
});
test("HTML result count without product links remains unavailable rather than out of stock",()=>{
  const r=search(searchPage());
  assert.equal(r.status,"SEARCH_DISCOVERY_UNAVAILABLE");
  assert.equal(r.searchResultCount,1301);
  assert.equal(r.candidates,0);
  assert.equal(r.customerPublishable,false);
  assert.equal(r.verifiedPriceCount,0);
});
test("redirect or changed search query cannot certify unrelated results",()=>{
  assert.equal(search(searchPage(),{finalUrl:oliveYoungSearchUrl("laptop")}).status,"SEARCH_CONTEXT_MISMATCH");
  assert.equal(search(searchPage(),{finalUrl:"https://evil.test/global/search/results?query=sunscreen"}).status,"SEARCH_CONTEXT_MISMATCH");
  assert.equal(search(searchPage({q:"hair serum"})).status,"SEARCH_QUERY_EVIDENCE_MISSING");
});
test("empty or ambiguous listing does not invent results",()=>{
  assert.equal(search("<html><body>Recommendations only</body></html>").status,"SEARCH_QUERY_EVIDENCE_MISSING");
  assert.equal(search("<html><head><title>Access Denied</title></head></html>").status,"SEARCH_ERROR_SHELL");
  assert.equal(search("x".repeat(3_000_001)).status,"SEARCH_HTML_MISSING_OR_OVERSIZED");
  const links=search(searchPage().replace("</main>",
    '<a href="'+pdpUrl+'">Expected product</a></main>'));
  assert.equal(links.status,"SEARCH_PRODUCT_LINKS_WITHOUT_SCOPED_PRICE");
  assert.equal(links.candidates,0);
});
test("PDP exact buybox price is not crossed-out, recommendation or promotion price",()=>{
  const r=product(pdp());
  assert.equal(r.status,"PDP_PRICE_OBSERVED_SHIPPING_UNKNOWN");
  assert.equal(r.price,16.2);
  assert.equal(r.originalPrice,18);
  assert.equal(r.currency,"USD");
  assert.equal(r.productId,productId);
  assert.equal(r.verified,true);
  assert.equal(r.customerPublishable,false);
  assert.equal(r.canShipToSaudi,null);
  assert.equal(r.availability,"unknown");
});
test("PDP delivery heading Global (Select Location) does not prove Saudi availability",()=>{
  const r=product(pdp({destination:"SAUDI ARABIA"}));
  assert.equal(r.displayedDestination,"SAUDI ARABIA");
  assert.equal(r.shippingToSaudiVerified,false);
  assert.equal(r.canShipToSaudi,null);
  assert.equal(r.availability,"unknown");
});
test("PDP price mismatch against cart button fails closed",()=>{
  assert.equal(product(pdp({cart:"Add to Cart - US$18.00"})).status,"PDP_CART_PRICE_MISMATCH");
  assert.equal(product(pdp({price:"SAR16.20"})).verified,false);
  assert.equal(product(pdp({was:"US$10.00"})).status,"PDP_INVERTED_DISCOUNT");
});
test("PDP no buybox, no price, disabled button, and challenge HTML fail closed",()=>{
  assert.equal(product(pdp({buttonDisabled:true})).verified,false);
  assert.equal(product(pdp({price:""})).verified,false);
  assert.equal(product(pdp().replace('class="prd-detail-content"','class="unrelated"')).verified,false);
  assert.equal(product(pdp().replace('class="detail-page"','class="neterror"')).verified,false);
});
test("PDP wrong product, wrong origin and bad observation time rejected",()=>{
  assert.equal(product(pdp(),{finalUrl:"https://global.oliveyoung.com/product/detail?prdtNo=GA999999999"}).verified,false);
  assert.equal(product(pdp(),{finalUrl:"https://evil.test/product/detail?prdtNo="+productId}).verified,false);
  assert.equal(product(pdp(),{observedAt:"not-a-date"}).verified,false);
});
test("search coordinator returns no offers even with positive result count",()=>{
  const r=evaluateOliveYoungSearch({query,html:searchPage(),searchUrl,finalUrl:searchUrl});
  assert.equal(r.diagnostics.status,"SEARCH_DISCOVERY_UNAVAILABLE");
  assert.equal(r.diagnostics.liveFetchAttempts,0);
  assert.deepEqual(r.offers,[]);
});
test("known-product verifier performs exactly one bounded PDP read and no publication",async()=>{
  let calls=0;
  const r=await verifyOliveYoungKnownProduct({
    productUrl:pdpUrl,fetchPdp:async url=>{
      calls++;assert.equal(url,pdpUrl);
      return {html:pdp(),finalUrl:url};
    },
  });
  assert.equal(calls,1);
  assert.equal(r.price,16.2);
  assert.equal(r.customerPublishable,false);
  let denyCount=0;
  const bad=await verifyOliveYoungKnownProduct({productUrl:"https://evil.test",
    fetchPdp:async()=>{denyCount++}});
  assert.equal(bad.verified,false);
  assert.equal(denyCount,0);
});
test("source registered and disabled by default; non-source request profiles unchanged",async()=>{
  const oldA=process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED;
  const oldB=process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED;
  try{
    delete process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED;
    delete process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED;
    assert.equal(oliveYoungLiveConfigured(),false);
    assert.equal(configuredFreeStorefronts().some(x=>x.id==="oliveyoung-global"),true);
    assert.equal(routeFreeStorefronts("sunscreen").some(x=>x.store.id==="oliveyoung-global"),false);
    const result=await searchFreeStorefrontById("oliveyoung-global","sunscreen");
    assert.equal(result.diagnostics.status,"SOURCE_DISABLED");
    process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED="1";
    assert.equal(oliveYoungLiveConfigured(),false);
    const h=merchantRequestHeaders("oliveyoung-global",{"user-agent":"Mozilla/5.0","sec-ch-ua":"browser"});
    assert.equal(h["user-agent"],NAWAA_INDEXER_USER_AGENT);
    assert.equal(h["sec-ch-ua"],undefined);
    assert.deepEqual(merchantRequestHeaders("amazon-sa",{accept:"foo"}),{accept:"foo"});
  }finally{
    if(oldA===undefined)delete process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED;
    else process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED=oldA;
    if(oldB===undefined)delete process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED;
    else process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED=oldB;
  }
});
