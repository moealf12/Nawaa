import test from "node:test";
import assert from "node:assert/strict";
import {verifyAsosPdpEvidence} from "../src/asos-pdp-evidence.mjs";
import {asosSearchUrl} from "../src/asos-search-cards.mjs";
import {asosLiveConfigured,validateAsosLiveSearch} from "../server/providers/asos-live.mjs";

const id="202389207",colour="202389212",q="nike shoes";
const url="https://www.asos.com/nike/shoe/prd/"+id+"#colourWayId-"+colour;
const candidate={productId:id,variantId:colour,sourceUrl:url,price:89.99};
const searchUrl=asosSearchUrl(q);
function pdp({price="89.99",currency="GBP",stock="https://schema.org/InStock",
    productId=id,variant=colour,errorShell=false}={}){
  const offer={url:"https://www.asos.com/nike/shoe/prd/"+id+"#colourWayId-"+variant,
    price,priceCurrency:currency,availability:stock};
  return '<html lang="en-GB" data-country-code="GB" data-store-code="COM"><body'+
    (errorShell?' class="neterror"':'')+'><script type="application/ld+json">'+
    JSON.stringify({"@type":"Product",productID:productId,offers:[offer]})+
    '</script></body></html>';
}
const check=(html,override={})=>verifyAsosPdpEvidence(html,{...candidate,...override},{
  finalUrl:"https://www.asos.com/nike/shoe/prd/"+id,observedAt:"2026-11-03T01:00:00.000Z"});
function listing(){
  return '<html lang="en-GB" data-country-code="GB" data-store-code="COM">'+
    '<ul data-testid="listing-results-1"><li id="product-'+id+'" class="productTile_x">'+
    '<a href="'+url+'" class="productLink_x"><p id="pta-product-'+id+'-0">Nike shoes</p>'+
    '<p id="pta-product-'+id+'-1" aria-label="Original price: £109.99, current price: £89.99">'+
    '<span class="originalPrice_x">£109.99</span><span class="saleAmount_x">£89.99</span>'+
    '</p></a></li></ul></html>';
}
test("exact PDP identity, market, colour, GBP price and variant stock attest",()=>{
  const e=check(pdp());
  assert.equal(e.verified,true);assert.equal(e.price,89.99);
  assert.equal(e.availability,"in_stock");
});
test("HTTP 200 error shell never verifies stock, even with a true availability hint",()=>{
  assert.equal(check(pdp({errorShell:true})).reason,"HTTP_200_PDP_ERROR_SHELL");
  assert.equal(check(pdp({stock:"https://schema.org/OutOfStock"})).availability,"out_of_stock");
});
test("PDP price mismatch and unknown availability fail closed",()=>{
  assert.equal(check(pdp({price:"109.99"})).reason,"SEARCH_PDP_PRICE_MISMATCH");
  assert.equal(check(pdp({stock:"https://schema.org/PreOrder"})).verified,false);
  assert.equal(check(pdp({currency:"USD"})).verified,false);
});
test("colour mismatch, identity mismatch, changed market fail closed",()=>{
  assert.equal(check(pdp({variant:"202389213"})).reason,"PDP_VARIANT_PRICE_STOCK_UNATTESTED");
  assert.equal(check(pdp({productId:"999999999"})).verified,false);
  assert.equal(check(pdp().replace('data-country-code="GB"','data-country-code="SA"')).verified,false);
});
test("no PDP stock-price data means UNKNOWN, never a zero-price listing or sold-out claim",()=>{
  const net='<html lang="en-GB" data-country-code="GB" data-store-code="COM"><body class="neterror"></body></html>';
  assert.equal(check(net).availability,"unknown");
  assert.equal(check('<html lang="en-GB" data-country-code="GB" data-store-code="COM"><body></body></html>').verified,false);
});
test("conflicting exact variant stock evidence cannot become verified",()=>{
  const x=pdp().replace('</script>',',{"@type":"Product"}</script>'); // malformed payload fails closed
  assert.equal(check(x).verified,false);
  const json=[{"@type":"Product",productID:id,offers:[
    {url,price:"89.99",priceCurrency:"GBP",availability:"https://schema.org/InStock"},
    {url,price:"89.99",priceCurrency:"GBP",availability:"https://schema.org/OutOfStock"}
  ]}];
  const body='<html lang="en-GB" data-country-code="GB" data-store-code="COM"><body>'+
    '<script type="application/ld+json">'+JSON.stringify(json)+'</script></body></html>';
  assert.equal(check(body).reason,"PDP_CONFLICTING_EVIDENCE");
});
test("live coordinator only fetches at most two exact first-party PDPs and withholds publication",async()=>{
  const targets=[];
  const r=await validateAsosLiveSearch({
    query:q,html:listing(),searchUrl,finalUrl:searchUrl,
    fetchPdp:async u=>{targets.push(u);return {html:pdp(),finalUrl:u}},
  });
  assert.equal(targets.length,1);assert.equal(targets[0],url);
  assert.equal(r.accepted.length,1);
  assert.equal(r.diagnostics.validated,1);
  assert.equal(r.diagnostics.customerPublishable,false);
});
test("HTTP 403 and 429 stop PDP requests without a retry or alternate transport",async()=>{
  for(const status of [403,429]){
    let calls=0;
    const r=await validateAsosLiveSearch({
      query:q,html:listing(),searchUrl,finalUrl:searchUrl,
      fetchPdp:async()=>{calls++;const e=new Error("HTTP "+status);e.status=status;throw e},
    });
    assert.equal(calls,1);
    assert.equal(r.accepted.length,0);
    assert.equal(r.diagnostics.unknown,1);
  }
});
test("missing user-authorized runtime switches stay disabled, with no outgoing request",async()=>{
  const wasA=process.env.NAWAA_ASOS_LIVE_ENABLED;
  const wasB=process.env.NAWAA_ASOS_SOURCE_AUTHORIZED;
  try{
    delete process.env.NAWAA_ASOS_LIVE_ENABLED;
    delete process.env.NAWAA_ASOS_SOURCE_AUTHORIZED;
    assert.equal(asosLiveConfigured(),false);
    const {searchFreeStorefrontById,routeFreeStorefronts,configuredFreeStorefronts}=
      await import("../server/providers/free-storefronts.mjs");
    assert.equal(routeFreeStorefronts("asos dresses").some(x=>x.store.id==="asos-global"),false);
    assert.equal(configuredFreeStorefronts().some(x=>x.id==="asos-global"),true); // registered, but not routed
    const disabled=await searchFreeStorefrontById("asos-global","nike shoes");
    assert.equal(disabled.diagnostics.status,"SOURCE_DISABLED");
    process.env.NAWAA_ASOS_LIVE_ENABLED="1";
    assert.equal(asosLiveConfigured(),false);
    process.env.NAWAA_ASOS_SOURCE_AUTHORIZED="1";
    assert.equal(asosLiveConfigured(),true);
    assert.equal(configuredFreeStorefronts().some(x=>x.id==="asos-global"),true);
  }finally{
    if(wasA===undefined)delete process.env.NAWAA_ASOS_LIVE_ENABLED;else process.env.NAWAA_ASOS_LIVE_ENABLED=wasA;
    if(wasB===undefined)delete process.env.NAWAA_ASOS_SOURCE_AUTHORIZED;else process.env.NAWAA_ASOS_SOURCE_AUTHORIZED=wasB;
  }
});
