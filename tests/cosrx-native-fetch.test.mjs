import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {NAWAA_INDEXER_USER_AGENT} from "../src/source-http-profile.mjs";

const handle="vitamin-e-vitalizing-sunscreen-spf-50";
const url="https://www.cosrx.com/products/"+handle;
const search='<html lang="en"><head><title>Search: 78 results found for "sunscreen" – COSRX Official</title></head>'+
  '<body><div class="collection-listing"><div class="product-list">'+
  '<div data-product-id="9074593464536" class="product-block">'+
  '<div class="product-info"><a class="product-link" href="'+url+'?_pos=1&amp;_ss=r">'+
  '<span class="product-block__title">Vitamin E Vitalizing Sunscreen SPF 50+</span>'+
  '<div class="product-price-data"><span class="product-price__amount">$23.00</span></div>'+
  '</a></div></div></div></div></body></html>';
const product=JSON.stringify({
  id:9074593464536,handle,title:"Vitamin E Vitalizing Sunscreen SPF 50+",
  available:true,variants:[{id:51101999038680,title:"Default Title",available:true,
    price:2300,compare_at_price:2300}]
});
async function enabled(fn){
  const prev=process.env.NAWAA_COSRX_LIVE_ENABLED;
  process.env.NAWAA_COSRX_LIVE_ENABLED="1";
  try{return await fn()}finally{
    if(prev===undefined)delete process.env.NAWAA_COSRX_LIVE_ENABLED;
    else process.env.NAWAA_COSRX_LIVE_ENABLED=prev;
  }
}
test("native COSRX search → exact product.js returns trusted evidence without publishing any offer",
  {concurrency:false},async()=>{
    await enabled(async()=>{
      const old=globalThis.fetch,requests=[];
      try{
        globalThis.fetch=async(input,init={})=>{
          requests.push({url:String(input),init});
          return new Response(requests.length===1?search:product,{
            status:200,headers:{"content-type":requests.length===1?"text/html":"application/javascript"}
          });
        };
        const r=await searchFreeStorefrontById("cosrx-global","sunscreen",{perStore:3});
        assert.equal(requests.length,2);
        assert.equal(requests[0].url,"https://www.cosrx.com/search?type=product&q=sunscreen");
        assert.equal(requests[1].url,url+".js");
        assert.equal(requests[0].init.redirect,"manual");
        assert.equal(requests[1].init.redirect,"manual");
        for(const x of requests){
          assert.equal(x.init.headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
          assert.equal(x.init.headers["sec-ch-ua"],undefined);
        }
        assert.equal(r.candidates,1);
        assert.deepEqual(r.offers,[]);
        assert.equal(r.diagnostics.cosrx.verifiedSamples,1);
        assert.equal(r.diagnostics.cosrx.shippingToSaudiVerified,false);
        assert.equal(r.diagnostics.customerPublicationGate.customerPublishable,false);
      }finally{globalThis.fetch=old;}
    });
  });
test("JSON HTTP 403 cannot be retried; no invalid price can reach customer search",
  {concurrency:false},async()=>{
    await enabled(async()=>{
      const old=globalThis.fetch;let calls=0;
      try{
        globalThis.fetch=async()=>{
          calls++;
          return calls===1?
            new Response(search,{status:200,headers:{"content-type":"text/html"}}):
            new Response("denied",{status:403,headers:{"content-type":"text/plain"}});
        };
        const r=await searchFreeStorefrontById("cosrx-global","sunscreen");
        assert.equal(calls,2);
        assert.equal(r.offers.length,0);
        assert.equal(r.diagnostics.cosrx.verifiedSamples,0);
        assert.equal(r.failures,1);
      }finally{globalThis.fetch=old;}
    });
  });
test("search HTTP 302 to foreign host fails closed and never follows a second request",
  {concurrency:false},async()=>{
    await enabled(async()=>{
      const old=globalThis.fetch;let calls=0;
      try{
        globalThis.fetch=async(_,init={})=>{
          calls++;assert.equal(init.redirect,"manual");
          return new Response(null,{status:302,
            headers:{location:"https://external.invalid/secret"}});
        };
        const r=await searchFreeStorefrontById("cosrx-global","sunscreen");
        assert.equal(calls,1);
        assert.equal(r.offers.length,0);
        assert.equal(r.diagnostics.cosrx.validated,0);
      }finally{globalThis.fetch=old;}
    });
  });
