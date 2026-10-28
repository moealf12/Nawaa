import test from "node:test";
import assert from "node:assert/strict";
import {observeDecathlonSearchEvidence} from "../server/decathlon-shadow-gate.mjs";
import {auditDecathlonFulfillmentEvidence} from "../scripts/audit-decathlon-fulfillment-evidence.mjs";
const url="https://decathlon.com.sa/products/source-shoe";
function html(available=true){
  const graph={"@type":"Product",name:"Source Shoe",url};
  const v={productVariants:[{id:"12345",sku:"SHOE-10",availableForSale:available,
    price:{amount:"99.00",currencyCode:"SAR"},
    product:{url:"/products/source-shoe",title:"Source Shoe"}}]};
  return '<html><head><link rel="canonical" href="'+url+'">'+
    '<meta property="og:title" content="Source Shoe">'+
    '<meta name="twitter:image" content="https://decathlon.com.sa/cdn/a.jpg"></head>'+
    '<body><main><div data-sku="SHOE-10"></div><form action="/cart/add">'+
    '<input name="id" value="12345"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(graph)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify(v)+' });</script></body></html>';
}
const xml='<urlset><url><loc>'+url+'</loc></url></urlset>';
test("shadow enabled exposes only variant-level merchant stock signal without customer promotion",()=>{
  const observed=observeDecathlonSearchEvidence({
    enabled:true,requestedUrl:url,finalUrl:url,html:html(),
    fetchedAtMs:100_000,nowMs:100_001,
  });
  assert.equal(observed.variantPriceOwned,true);
  assert.equal(observed.merchantAvailableSignal,true);
  assert.equal(observed.availabilitySignalStatus,"VARIANT_AVAILABILITY_OBSERVED_DELIVERY_UNVERIFIED");
  assert.equal(observed.inventoryVerified,false);
  assert.equal(observed.shippingVerified,false);
  assert.equal(observed.checkoutVerified,false);
  assert.equal(observed.trustedOfferEligible,false);
  assert.equal(observed.customerVisible,false);
  for(const secret of ["99.00","SHOE-10","12345","source-shoe","https://"])
    assert.equal(JSON.stringify(observed).includes(secret),false);
});
test("shadow disabled never reports stock signals",()=>{
  assert.equal(observeDecathlonSearchEvidence({
    enabled:false,requestedUrl:url,finalUrl:url,html:html(),
    fetchedAtMs:100_000,nowMs:100_001,
  }),null);
});
test("read-only live audit samples one PDP and never contacts any delivery or checkout endpoint",async()=>{
  let sitemapCalls=0,pdpCalls=0;
  const observed=await auditDecathlonFulfillmentEvidence({
    fetchSitemap:async()=>{sitemapCalls++;return new Response(xml,{status:200,
      headers:{"content-type":"application/xml"}})},
    fetchPdp:async(u)=>{pdpCalls++;assert.equal(u,url);return {html:html(),finalUrl:url};},
  });
  assert.deepEqual([sitemapCalls,pdpCalls],[1,1]);
  assert.equal(observed.merchantAvailableSignal,true);
  assert.equal(observed.availabilitySignalStatus,"VARIANT_AVAILABILITY_OBSERVED_DELIVERY_UNVERIFIED");
  assert.equal(observed.shippingVerified,false);
  assert.equal(observed.quoteAllowed,false);
  assert.equal(observed.publishedOfferCount,0);
});
test("HTTP 403/429 on sitemap causes no PDP request or stock claims",async()=>{
  for(const status of [403,429]){
    let pdpCalls=0;
    const r=await auditDecathlonFulfillmentEvidence({
      fetchSitemap:async()=>new Response(null,{status}),
      fetchPdp:async()=>{pdpCalls++;throw Error("should not fetch");},
    });
    assert.equal(pdpCalls,0);
    assert.equal(r.inventoryVerified,false);
    assert.equal(r.publishedOfferCount,0);
  }
});
test("PDP redirect or access failure never turns into stock availability",async()=>{
  const redirect=await auditDecathlonFulfillmentEvidence({
    fetchSitemap:async()=>new Response(xml,{status:200,headers:{"content-type":"text/xml"}}),
    fetchPdp:async()=>({finalUrl:"https://decathlon.com.sa/products/other",html:html()}),
  });
  assert.equal(redirect.availabilitySignalStatus,"PDP_IDENTITY_CONFLICT");
  assert.equal(redirect.merchantAvailableSignal,null);
  const blocked=await auditDecathlonFulfillmentEvidence({
    fetchSitemap:async()=>new Response(xml,{status:200,headers:{"content-type":"text/xml"}}),
    fetchPdp:async()=>{throw Error("HTTP 403");},
  });
  assert.equal(blocked.availabilitySignalStatus,"SOURCE_NOT_ACCESSIBLE");
  assert.equal(blocked.inventoryVerified,false);
});
