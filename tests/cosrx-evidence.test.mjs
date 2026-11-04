import test from "node:test";
import assert from "node:assert/strict";
import {cosrxSearchUrl,cosrxIdentity,cosrxProductJsonUrl,cosrxUSD,
  cosrxSearchContext,parseCosrxSearchCards,verifyCosrxVariantJson}
  from "../src/cosrx-evidence.mjs";
import {fetchCosrxPublicProductJson,evaluateCosrxSearch,cosrxLiveConfigured}
  from "../server/providers/cosrx-live.mjs";
import {NAWAA_INDEXER_USER_AGENT,merchantRequestHeaders}
  from "../src/source-http-profile.mjs";
import {searchFreeStorefrontById,routeFreeStorefronts,configuredFreeStorefronts}
  from "../server/providers/free-storefronts.mjs";

const q="sunscreen",url=cosrxSearchUrl(q);
const id="9074593464536",handle="vitamin-e-vitalizing-sunscreen-spf-50";
const itemUrl="https://www.cosrx.com/products/"+handle;
const variant="51101999038680";
const title="Vitamin E Vitalizing Sunscreen SPF 50+";
function tile({productId=id,slug=handle,amount="$23.00",name=title}={}){
  return '<div data-product-id="'+productId+'" class="product-block cc-animate-init">'+
    '<div class="image-cont"><div class="product-block__image--primary">'+
    '<img data-src="//www.cosrx.com/cdn/shop/files/sunscreen_{width}x.jpg?v=1">'+
    '</div><a class="product-link" href="/products/'+slug+'">picture</a></div>'+
    '<div class="product-info"><a class="product-link" href="'+
      'https://www.cosrx.com/products/'+slug+'?_pos=1&amp;_sid=test&amp;_ss=r">'+
      '<div class="product-block__title">'+name+'</div>'+
      '<div class="product-price"><div class="product-price-data">'+
      '<span class="product-price__item product-price__amount theme-money">'+amount+'</span>'+
      '</div></div></a></div></div>';
}
function searchHtml(...tiles){
  return '<html lang="en"><head><title>Search: 78 results found for "sunscreen" – COSRX Official</title></head>'+
    '<body>United States (USD $)<div class="collection-listing"><div class="product-list">'+
    tiles.join("")+'</div></div><footer><span>$1.99 promotion</span></footer></body></html>';
}
const candidate={productId:id,handle,sourceUrl:itemUrl,title,price:23};
function productJson(override={}){
  return {id:Number(id),handle,title,vendor:"COSRX Official",available:true,
    price:2300,variants:[{id:Number(variant),title:"Default Title",
      available:true,price:2300,compare_at_price:2300}],
    ...override};
}
const search=(html,opts={})=>parseCosrxSearchCards(html,q,{
  requestedUrl:url,finalUrl:url,...opts});
const check=(payload,card=candidate)=>verifyCosrxVariantJson(payload,card,{
  observedAt:"2026-11-04T00:00:00Z"});

test("official first-party search URL handles arbitrary queries and strict duplicates",()=>{
  assert.equal(new URL(cosrxSearchUrl("شنطة")).searchParams.get("q"),"شنطة");
  assert.equal(new URL(cosrxSearchUrl("Vitamin C +")).searchParams.get("q"),"Vitamin C +");
  assert.equal(cosrxSearchContext({query:q,requestedUrl:url,finalUrl:url}),true);
  assert.equal(cosrxSearchContext({query:q,requestedUrl:url,finalUrl:url+"&q=sunscreen"}),false);
  assert.throws(()=>cosrxSearchUrl(" "),/INVALID_QUERY/);
});
test("canonical product and JSON URLs require first-party exact handle",()=>{
  assert.deepEqual(cosrxIdentity(itemUrl),{handle,sourceUrl:itemUrl});
  assert.deepEqual(cosrxIdentity("/products/"+handle+"?_pos=1&_ss=r"),
    {handle,sourceUrl:itemUrl});
  assert.equal(cosrxIdentity("//attacker.example/products/"+handle),null);
  assert.equal(cosrxProductJsonUrl(itemUrl),itemUrl+".js");
  for(const x of ["https://evil.test/products/"+handle,
    "https://www.cosrx.com.evil.test/products/"+handle,
    "https://www.cosrx.com/products/"+handle+".js",
    "https://www.cosrx.com/cart/add",
    "http://www.cosrx.com/products/"+handle])
    assert.equal(cosrxIdentity(x),null);
});
test("strict current USD amounts reject alternate currencies or zero",()=>{
  assert.equal(cosrxUSD("$23.00"),23);
  assert.equal(cosrxUSD("US$1,290.95"),1290.95);
  for(const x of ["23.00","SAR23.00","£23.00","$0.00","$3.2","$1.290,95"])
    assert.equal(cosrxUSD(x),null,x);
});
test("real Shopify card classes extract query-bound product and USD price",()=>{
  const r=search(searchHtml(tile()));
  assert.equal(r.diagnostics.status,"PARSED_QUERY_BOUND_USD_CARDS");
  assert.equal(r.candidates.length,1);
  assert.equal(r.candidates[0].productId,id);
  assert.equal(r.candidates[0].sourceUrl,itemUrl);
  assert.equal(r.candidates[0].price,23);
  assert.equal(r.candidates[0].image,
    "https://www.cosrx.com/cdn/shop/files/sunscreen_460x.jpg?v=1");
  assert.equal(r.candidates[0].customerPublishable,false);
  assert.equal(r.candidates[0].availability,"unknown");
});
test("search title/redirect/query mismatch and challenge shells fail closed",()=>{
  assert.equal(search(searchHtml(tile()),{finalUrl:"https://evil.test/search?type=product&q=sunscreen"}).candidates.length,0);
  assert.equal(search(searchHtml(tile()).replace('for "sunscreen"','for "toner"')).diagnostics.status,"SEARCH_QUERY_TITLE_MISSING");
  assert.equal(search('<html><head><title>Access denied</title></head></html>').diagnostics.status,"SEARCH_ERROR_SHELL");
});
test("off-domain products, invalid prices and duplicate card price contradictions cannot publish",()=>{
  assert.equal(search(searchHtml(tile({slug:"x".repeat(180)}))).candidates.length,0);
  assert.equal(search(searchHtml(tile({amount:"SAR 23.00"}))).candidates.length,0);
  const a=tile(),b=tile({amount:"$20.00"});
  assert.equal(search(searchHtml(a,a)).candidates.length,1);
  const r=search(searchHtml(a,b));
  assert.equal(r.diagnostics.conflicts,1);
  assert.equal(r.candidates.length,0);
});
test("bounded search cards with empty/oversized input",()=>{
  const html=searchHtml(tile(),tile({productId:"9074593464537",slug:"cosrx-other-sunscreen"}));
  assert.equal(search(html,{maxCards:1}).candidates.length,1);
  assert.equal(search(html,{maxCards:0}).candidates.length,0);
  assert.equal(search("x".repeat(3_500_001)).diagnostics.status,"SEARCH_HTML_MISSING_OR_OVERSIZED");
});
test("exact single Shopify variant verifies JSON cents price and stock, not Saudi delivery",()=>{
  const r=check(productJson());
  assert.equal(r.verified,true);
  assert.equal(r.variantId,variant);
  assert.equal(r.price,23);
  assert.equal(r.currency,"USD");
  assert.equal(r.availability,"in_stock");
  assert.equal(r.shippingToSaudiVerified,false);
  assert.equal(r.canShipToSaudi,null);
  assert.equal(r.customerPublishable,false);
});
test("price mismatch, availability contradiction, wrong product/title/handle fail closed",()=>{
  assert.equal(check(productJson({id:9074593464537})).reason,"PRODUCT_IDENTITY_MISMATCH");
  assert.equal(check(productJson({handle:"different"})).verified,false);
  assert.equal(check(productJson({title:"Random COSRX Cleanser"})).verified,false);
  assert.equal(check(productJson({available:false})).reason,"STOCK_CONFLICT");
  assert.equal(check(productJson({variants:[{id:Number(variant),title:"Default Title",available:true,price:2400}]})).reason,"SEARCH_JSON_PRICE_MISMATCH");
});
test("multi-variant products require exact selected variant, no aggregate stock inference",()=>{
  const multi=productJson({variants:[
    {id:51101999038680,price:2300,available:true},
    {id:51101999038681,price:2200,available:false}
  ]});
  assert.equal(check(multi).reason,"VARIANT_SELECTION_REQUIRED");
  const explicit=check(multi,{...candidate,variantId:"51101999038681",price:22});
  assert.equal(explicit.verified,true);
  assert.equal(explicit.availability,"out_of_stock");
});
test("invalid JSON, variant shape, compare-price inversion all reject",()=>{
  assert.equal(check("not JSON").reason,"PRODUCT_JSON_INVALID");
  assert.equal(check(productJson({variants:[]})).reason,"VARIANT_LIST_MISSING");
  assert.equal(check(productJson({variants:[{id:Number(variant),available:"yes",price:2300}]})).reason,"VARIANT_DATA_INVALID");
  assert.equal(check(productJson({variants:[{id:Number(variant),available:true,price:2300,compare_at_price:1200}]})).reason,"COMPARE_PRICE_INVERTED");
});
test("coordinator uses at most 2 exact product JSON reads and yields no published prices",async()=>{
  let calls=0;
  const r=await evaluateCosrxSearch({
    query:q,searchUrl:url,finalUrl:url,
    html:searchHtml(tile()),
    fetchProductJson:async requested=>{
      calls++;assert.equal(requested,itemUrl);
      return {text:JSON.stringify(productJson())};
    }
  });
  assert.equal(calls,1);
  assert.equal(r.candidates,1);
  assert.equal(r.verified.length,1);
  assert.equal(r.diagnostics.customerPublishable,false);
  assert.equal(r.diagnostics.shippingToSaudiVerified,false);
});
test("403 and 429 stop JSON flow without retry",async()=>{
  for(const status of [403,429]){
    let calls=0;
    const r=await evaluateCosrxSearch({
      query:q,searchUrl:url,finalUrl:url,html:searchHtml(tile(),
        tile({productId:"9074593464537",slug:"cosrx-other-sunscreen"})),
      fetchProductJson:async()=>{
        calls++;const e=new Error("HTTP "+status);e.status=status;throw e;
      }
    });
    assert.equal(calls,1);
    assert.equal(r.verified.length,0);
    assert.equal(r.records[0].reason,status===403?"HTTP_403_DENIED":"HTTP_429_LIMITED");
  }
});
test("public native JSON fetch pinned to COSRX and rejects 302, malformed content, oversize",async()=>{
  const calls=[];
  const good=await fetchCosrxPublicProductJson(itemUrl,{
    fetchImpl:async (target,opts)=>{
      calls.push({target,opts});
      return new Response(JSON.stringify(productJson()),{
        status:200,headers:{"content-type":"application/javascript"}
      });
    }
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].target,itemUrl+".js");
  assert.equal(calls[0].opts.redirect,"manual");
  assert.equal(calls[0].opts.headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
  assert.match(good.text,/"variants"/);
  await assert.rejects(fetchCosrxPublicProductJson("https://evil.test",{
    fetchImpl:async()=>{throw Error("should never fetch")}
  }),/NOT_ALLOWED/);
  await assert.rejects(fetchCosrxPublicProductJson(itemUrl,{
    fetchImpl:async()=>new Response(null,{status:302,headers:{location:"https://evil.test"}})
  }),/HTTP_302/);
  await assert.rejects(fetchCosrxPublicProductJson(itemUrl,{
    fetchImpl:async()=>new Response("<html>challenge</html>",{
      status:200,headers:{"content-type":"text/html"}})
  }),/BAD_CONTENT_TYPE/);
  await assert.rejects(fetchCosrxPublicProductJson(itemUrl,{
    fetchImpl:async()=>new Response(JSON.stringify(productJson()),{
      status:200,headers:{"content-type":"application/json","content-length":"999999"}})
  }),/TOO_LARGE/);
});
test("source registered, but default-disabled and honest headers do not affect other merchants",async()=>{
  const original=process.env.NAWAA_COSRX_LIVE_ENABLED;
  try{
    delete process.env.NAWAA_COSRX_LIVE_ENABLED;
    assert.equal(cosrxLiveConfigured(),false);
    assert.equal(configuredFreeStorefronts().some(x=>x.id==="cosrx-global"),true);
    assert.equal(routeFreeStorefronts("cosrx sunscreen").some(x=>x.store.id==="cosrx-global"),false);
    const disabled=await searchFreeStorefrontById("cosrx-global",q);
    assert.equal(disabled.diagnostics.status,"SOURCE_DISABLED");
    process.env.NAWAA_COSRX_LIVE_ENABLED="1";
    assert.equal(cosrxLiveConfigured(),true);
    const headers=merchantRequestHeaders("cosrx-global",{"user-agent":"FakeChrome","sec-ch-ua":"x"});
    assert.equal(headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
    assert.equal(headers["sec-ch-ua"],undefined);
    assert.deepEqual(merchantRequestHeaders("amazon-sa",{accept:"foo"}),{accept:"foo"});
  }finally{
    if(original===undefined)delete process.env.NAWAA_COSRX_LIVE_ENABLED;
    else process.env.NAWAA_COSRX_LIVE_ENABLED=original;
  }
});
