import test from "node:test";
import assert from "node:assert/strict";
import {evaluateDecathlonQuoteReadiness} from "../server/decathlon-quote-readiness.mjs";
const url="https://decathlon.com.sa/products/kalenji-shoes";
function source({sku="KAL-10",variant="12345",recordSku=sku,recordVariant=variant,
  price="99.00",currency="SAR",title="Kalenji Shoes"}={}){
  const product={"@context":"https://schema.org","@type":"Product",name:title,url};
  const variantData={productVariants:[{id:recordVariant,sku:recordSku,
    price:{amount:price,currencyCode:currency},
    image:{src:"https://decathlon.com.sa/cdn/shoe.jpg"},
    product:{url:"/products/kalenji-shoes",title},title:"Default Title"}]};
  return '<html><head><link rel="canonical" href="'+url+'">'+
    '<meta property="og:title" content="'+title+'">'+
    '<meta name="twitter:image" content="https://decathlon.com.sa/cdn/shoe.jpg"></head>'+
    '<body><main><span data-sku="'+sku+'"></span>'+
    '<form action="/cart/add"><input name="id" value="'+variant+'"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(product)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify(variantData)+' });</script></body></html>';
}
function snapshot(html=source(),at=100_000,override={}){
  return {url,finalUrl:url,html,receivedAtMs:at,httpStatus:200,...override};
}
const params=(search=snapshot(),quote=snapshot(source(),105_000),nowMs=106_000)=>({
  search,quote,nowMs,
});
function blocked(r){
  assert.equal(r.quoteAllowed,false);
  assert.equal(r.checkoutAllowed,false);
  assert.equal(r.customerOfferEligible,false);
  assert.equal(r.inventoryVerified,false);
  assert.equal(r.shippingVerified,false);
  assert.equal(r.storePriceFreshnessCertified,false);
  assert.equal("price" in r,false);
  assert.equal("sku" in r,false);
  assert.equal("url" in r,false);
}
test("RED v22.03: 2 independent matching PDP observations still fail closed on stock/shipping evidence",()=>{
  const r=evaluateDecathlonQuoteReadiness(params());
  assert.equal(r.status,"STOCK_AND_DELIVERY_UNVERIFIED");
  assert.equal(r.sameSelectedVariant,true);
  assert.equal(r.samePriceBetweenObservations,true);
  assert.equal(r.revalidationWasIndependent,true);
  blocked(r);
});
test("RED v22.03: price drift refuses quote even if product identity stable",()=>{
  const r=evaluateDecathlonQuoteReadiness(params(snapshot(),snapshot(source({price:"129.00"}),105_000)));
  assert.equal(r.status,"PRICE_CHANGED_REQUOTE_REQUIRED");
  assert.equal(r.sameSelectedVariant,true);
  assert.equal(r.samePriceBetweenObservations,false);
  blocked(r);
});
test("RED v22.03: alternate SKU or selected variant cannot borrow earlier price",()=>{
  for(const version of [{sku:"OTHER-SKU",recordSku:"OTHER-SKU"},{variant:"77777",recordVariant:"77777"}]){
    const r=evaluateDecathlonQuoteReadiness(params(snapshot(),snapshot(source(version),105_000)));
    assert.equal(r.status,"SELECTED_PRODUCT_CHANGED");
    assert.equal(r.sameSelectedVariant,false);
    blocked(r);
  }
});
test("RED v22.03: stale search snapshot or stale quote replay cannot be presented as a current quote",()=>{
  for(const args of [
    params(snapshot(source(),10_000),snapshot(source(),105_000),106_000),
    params(snapshot(),snapshot(source(),80_000),130_000),
    params(snapshot(),snapshot(source(),107_000),106_000),
  ]){
    const r=evaluateDecathlonQuoteReadiness(args);
    assert.equal(r.status,"SOURCE_OBSERVATION_EXPIRED_OR_INVALID");
    blocked(r);
  }
});
test("RED v22.03: no independently re-fetched quote PDP means no quote revalidation",()=>{
  const r=evaluateDecathlonQuoteReadiness(params(snapshot(),null));
  assert.equal(r.status,"QUOTE_SOURCE_REVALIDATION_REQUIRED");
  assert.equal(r.revalidationWasIndependent,false);
  blocked(r);
});
test("RED v22.03: source 403, 429, 404, 200 block page and redirects never mean out of stock",()=>{
  for(const status of [403,429,404,500]){
    const r=evaluateDecathlonQuoteReadiness(params(snapshot(),snapshot("",105_000,{httpStatus:status})));
    assert.equal(r.status,"QUOTE_SOURCE_UNAVAILABLE");
    assert.equal(r.inventoryClaim,"unknown");
    blocked(r);
  }
  const r=evaluateDecathlonQuoteReadiness(params(snapshot(),
    snapshot(source(),105_000,{finalUrl:"https://decathlon.com.sa/products/another"})));
  assert.equal(r.status,"SOURCE_IDENTITY_MISMATCH");
  blocked(r);
});
test("RED v22.03: altered currency, missing SKU and malicious price cannot pass",()=>{
  for(const version of [{currency:"USD"},{recordSku:"fake"},{price:"0"}]){
    const r=evaluateDecathlonQuoteReadiness(params(snapshot(),snapshot(source(version),105_000)));
    assert.equal(r.status,"QUOTE_PRICE_OWNERSHIP_UNVERIFIED");
    blocked(r);
  }
});
test("RED v22.03: output is aggregate only with no source prices, identifiers or raw HTML",()=>{
  const result=evaluateDecathlonQuoteReadiness(params());
  const json=JSON.stringify(result);
  for(const secret of ["99.00","KAL-10","12345","kalenji-shoes","wpmLoader","https://"]){
    assert.equal(json.includes(secret),false,secret);
  }
});
