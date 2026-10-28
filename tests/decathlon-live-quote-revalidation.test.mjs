import test from "node:test";
import assert from "node:assert/strict";
import {auditDecathlonLiveQuoteRevalidation} from "../scripts/audit-decathlon-quote-revalidation.mjs";
const host="https://decathlon.com.sa",url=host+"/products/kalenji-shoes";
const sitemap='<urlset><url><loc>'+url+'</loc></url></urlset>';
function page(price="99.00"){
  const product={"@type":"Product",name:"Kalenji Shoes",url};
  const records={productVariants:[{id:"12345",sku:"SHOES-10",
    price:{amount:price,currencyCode:"SAR"},
    product:{url:"/products/kalenji-shoes",title:"Kalenji Shoes"}}]};
  return '<head><link rel="canonical" href="'+url+'">'+
    '<meta property="og:title" content="Kalenji Shoes">'+
    '<meta name="twitter:image" content="https://decathlon.com.sa/cdn/shoes.jpg"></head>'+
    '<body><main><span data-sku="SHOES-10"></span>'+
    '<form action="/cart/add"><input name="id" value="12345"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(product)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify(records)+' });</script></body>';
}
const xml=()=>new Response(sitemap,{status:200,headers:{"content-type":"application/xml"}});
const clock=()=>{let ms=100_000;return ()=>ms+=1000;};
test("one source-owned URL, two true PDP calls, stable variant/price still blocks binding quote",async()=>{
  let sitemapCalls=0,pdpCalls=0;
  const r=await auditDecathlonLiveQuoteRevalidation({
    fetchSitemap:async()=>{sitemapCalls++;return xml();},
    fetchPdp:async()=>{pdpCalls++;return {finalUrl:url,html:page()};},
    now:clock(),
  });
  assert.deepEqual([sitemapCalls,pdpCalls],[1,2]);
  assert.equal(r.hadTwoIndependentPdpFetches,true);
  assert.equal(r.revalidationStatus,"STOCK_AND_DELIVERY_UNVERIFIED");
  assert.equal(r.selectedVariantUnchanged,true);
  assert.equal(r.observedPriceUnchanged,true);
  assert.equal(r.quoteAllowed,false);
  assert.equal(r.checkoutAllowed,false);
  assert.equal(r.publishedOfferCount,0);
  assert.equal(r.inventoryVerified,false);
  assert.equal(r.sourcePriceFreshnessCertified,false);
  const json=JSON.stringify(r);
  for(const secret of ["99.00","SHOES-10","12345","kalenji-shoes"])
    assert.equal(json.includes(secret),false);
});
test("second PDP price changed: quote revalidation never promotes old amount",async()=>{
  let calls=0;
  const r=await auditDecathlonLiveQuoteRevalidation({
    fetchSitemap:async()=>xml(),
    fetchPdp:async()=>({finalUrl:url,html:page(++calls===1?"99.00":"119.00")}),
    now:clock(),
  });
  assert.equal(r.pdpRequests,2);
  assert.equal(r.revalidationStatus,"PRICE_CHANGED_REQUOTE_REQUIRED");
  assert.equal(r.observedPriceUnchanged,false);
  assert.equal(r.quoteAllowed,false);
});
test("source 403 and 429 never lead to any product-page request",async()=>{
  for(const status of [403,429]){
    let calls=0;
    const r=await auditDecathlonLiveQuoteRevalidation({
      fetchSitemap:async()=>new Response(null,{status}),
      fetchPdp:async()=>{calls++;throw Error("must not fetch");},
      now:clock(),
    });
    assert.equal(calls,0);
    assert.equal(r.quoteAllowed,false);
    assert.equal(r.pdpRequests,0);
  }
});
test("second PDP access failure cannot be treated as unavailable stock",async()=>{
  let calls=0;
  const r=await auditDecathlonLiveQuoteRevalidation({
    fetchSitemap:async()=>xml(),
    fetchPdp:async()=>{calls++;if(calls===2)throw Error("HTTP 429");return {finalUrl:url,html:page()};},
    now:clock(),
  });
  assert.equal(r.pdpRequests,2);
  assert.equal(r.revalidationStatus,"QUOTE_SOURCE_UNAVAILABLE");
  assert.equal(r.inventoryVerified,false);
  assert.equal(r.quoteAllowed,false);
});
