import test from "node:test";
import assert from "node:assert/strict";
import {NAWAA_INDEXER_USER_AGENT,ASOS_NODE_DOCUMENT_HEADERS,merchantRequestHeaders}
  from "../src/source-http-profile.mjs";
import {searchFreeStorefrontById,routeFreeStorefronts} from "../server/providers/free-storefronts.mjs";

const q="nike shoes",id="202389207",colour="202389212";
const pdpUrl="https://www.asos.com/nike/nike-shoe/prd/"+id+"#colourWayId-"+colour;
const listingHtml='<html lang="en-GB" data-country-code="GB" data-store-code="COM">'+
  '<ul data-testid="listing-results-1">'+
    '<li id="product-'+id+'" class="productTile_fixture">'+
      '<a href="'+pdpUrl+'">'+
        '<p id="pta-product-'+id+'-0">Nike shoes for women</p>'+
        '<p id="pta-product-'+id+'-1" aria-label="Original price: £109.99, current price: £89.99">'+
          '<span class="originalPrice_fixture">£109.99</span>'+
          '<span class="saleAmount_fixture">£89.99</span>'+
        '</p></a></li></ul></html>';
const productHtml=({errorShell=false,stock="https://schema.org/InStock"}={})=>
  '<html lang="en-GB" data-country-code="GB" data-store-code="COM"><body'+
    (errorShell?' class="neterror"':'')+'><script type="application/ld+json">'+
    JSON.stringify({"@type":"Product",productID:id,offers:{
      url:pdpUrl,price:"89.99",priceCurrency:"GBP",availability:stock
    }})+'</script></body></html>';
function authorized(fn){
  const old1=process.env.NAWAA_ASOS_LIVE_ENABLED,old2=process.env.NAWAA_ASOS_SOURCE_AUTHORIZED;
  process.env.NAWAA_ASOS_LIVE_ENABLED="1";
  process.env.NAWAA_ASOS_SOURCE_AUTHORIZED="1";
  return Promise.resolve().then(fn).finally(()=>{
    if(old1===undefined)delete process.env.NAWAA_ASOS_LIVE_ENABLED;
    else process.env.NAWAA_ASOS_LIVE_ENABLED=old1;
    if(old2===undefined)delete process.env.NAWAA_ASOS_SOURCE_AUTHORIZED;
    else process.env.NAWAA_ASOS_SOURCE_AUTHORIZED=old2;
  });
}
test("ASOS headers are consistent and never claim Chrome via client hints",()=>{
  const h=merchantRequestHeaders("asos-global",{
    "user-agent":"MockChrome/1.0","sec-ch-ua":'"Chromium";v="141"',"sec-fetch-site":"none",
    accept:"*/*",
  });
  assert.deepEqual(h,ASOS_NODE_DOCUMENT_HEADERS);
  assert.equal(h["user-agent"],NAWAA_INDEXER_USER_AGENT);
  assert.equal(h["accept-language"],"en-GB,en;q=0.9");
  assert.equal(h["sec-ch-ua"],undefined);
  assert.equal(h["sec-fetch-site"],undefined);
  assert.deepEqual(merchantRequestHeaders("amazon-de",{accept:"sample"}),{accept:"sample"});
});
test("default-disabled ASOS never initiates a network request", {concurrency:false},async()=>{
  const old=globalThis.fetch,prev=process.env.NAWAA_ASOS_LIVE_ENABLED;
  delete process.env.NAWAA_ASOS_LIVE_ENABLED;
  let count=0;
  try{
    globalThis.fetch=async()=>{count++;throw Error("no network allowed")};
    const r=await searchFreeStorefrontById("asos-global",q);
    assert.equal(r.diagnostics.status,"SOURCE_DISABLED");
    assert.equal(routeFreeStorefronts("asos shoes").some(x=>x.store.id==="asos-global"),false);
    assert.equal(count,0);
  }finally{
    globalThis.fetch=old;
    if(prev===undefined)delete process.env.NAWAA_ASOS_LIVE_ENABLED;
    else process.env.NAWAA_ASOS_LIVE_ENABLED=prev;
  }
});
test("authorized on-demand flow makes one search and one PDP request, no customer offers", {concurrency:false},async()=>{
  await authorized(async()=>{
    const old=globalThis.fetch;
    const requests=[];
    try{
      globalThis.fetch=async (input,init={})=>{
        const url=String(input);
        requests.push({url,headers:init.headers,redirect:init.redirect});
        return new Response(requests.length===1?listingHtml:productHtml(),{
          status:200,headers:{"content-type":"text/html"}
        });
      };
      const r=await searchFreeStorefrontById("asos-global",q,{perStore:2});
      assert.equal(requests.length,2);
      assert.equal(requests[0].redirect,"manual");
      assert.equal(requests[1].redirect,"manual");
      assert.match(requests[0].url,/^https:\/\/www\.asos\.com\/search\//);
      assert.match(requests[1].url,/\/prd\/202389207$/);
      for(const request of requests){
        assert.equal(request.headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
        assert.equal(request.headers["sec-ch-ua"],undefined);
      }
      assert.equal(r.candidates,1);
      assert.equal(r.offers.length,0);
      assert.equal(r.diagnostics.asosLive.acceptedEvidence,1);
      assert.equal(r.diagnostics.customerPublicationGate.customerPublishable,false);
    }finally{globalThis.fetch=old}
  });
});
test("200 + neterror cannot become verified product or out-of-stock assertion", {concurrency:false},async()=>{
  await authorized(async()=>{
    const old=globalThis.fetch;
    try{
      globalThis.fetch=async input=>new Response(String(input).includes("/search/")?listingHtml:productHtml({errorShell:true}),{
        status:200,headers:{"content-type":"text/html"}
      });
      const r=await searchFreeStorefrontById("asos-global",q,{perStore:2});
      assert.equal(r.candidates,1);
      assert.equal(r.offers.length,0);
      assert.equal(r.diagnostics.asosLive.acceptedEvidence,0);
      assert.equal(r.diagnostics.asosLive.unknown,1);
    }finally{globalThis.fetch=old}
  });
});
test("ASOS 302 redirects fail closed without following or cross-origin request", {concurrency:false},async()=>{
  await authorized(async()=>{
    const old=globalThis.fetch;
    const urls=[];
    try{
      globalThis.fetch=async (input,init={})=>{
        urls.push(String(input));
        assert.equal(init.redirect,"manual");
        return new Response("",{
          status:302,headers:{"location":"https://attacker.example/internal","content-type":"text/html"}
        });
      };
      const r=await searchFreeStorefrontById("asos-global",q,{perStore:2});
      assert.equal(urls.length,1);
      assert.equal(r.offers.length,0);
      assert.equal(r.diagnostics.asosLive.acceptedEvidence,0);
    }finally{globalThis.fetch=old}
  });
});
