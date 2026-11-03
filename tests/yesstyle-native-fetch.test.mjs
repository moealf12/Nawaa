import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {NAWAA_INDEXER_USER_AGENT} from "../src/source-http-profile.mjs";

const productUrl="https://www.yesstyle.com/en/anua-zero-cast-sunscreen/info.html/pid.1137266754";
const search='<html lang="en"><main><h1>"sunscreen"</h1><section class="__imageGridWrapper">'+
  '<a class="__itemContainer" href="'+productUrl+'"><div class="__itemTitle">Anua - Zero-Cast Sunscreen</div>'+
  '<div class="__itemPriceWrapper"><b class="__itemPrice">US$ 11.70</b>'+
  '<span class="__itemSellPrice">US$ 18.00</span></div></a></section></main></html>';
const pdp='<html lang="en"><main><div class="__PDPContainer"><h1>Anua - Zero-Cast Sunscreen</h1>'+
  '<div class="__priceContainer"><span class="__sellingPrice">US$ 11.70</span></div>'+
  '<div class="__roundCornerSelect"><span class="__option-title">50ml</span>'+
  '<span class="__option-additional-info">In-Stock</span></div>'+
  '<div class="__shippingInfo"><h6>Shipping to United States</h6></div></div></main></html>';
async function enabled(fn){
  const l=process.env.NAWAA_YESSTYLE_LIVE_ENABLED,a=process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED;
  process.env.NAWAA_YESSTYLE_LIVE_ENABLED="1";
  process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED="1";
  try{return await fn()}
  finally{
    if(l===undefined)delete process.env.NAWAA_YESSTYLE_LIVE_ENABLED;
    else process.env.NAWAA_YESSTYLE_LIVE_ENABLED=l;
    if(a===undefined)delete process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED;
    else process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED=a;
  }
}
test("enabled YesStyle requests are first-party, one listing plus one PDP, no customer offers",
  {concurrency:false},async()=>{
    await enabled(async()=>{
      const previous=globalThis.fetch,requests=[];
      try{
        globalThis.fetch=async (input,init={})=>{
          requests.push({url:String(input),headers:init.headers,redirect:init.redirect});
          return new Response(requests.length===1?search:pdp,{
            status:200,headers:{"content-type":"text/html"}
          });
        };
        const r=await searchFreeStorefrontById("yesstyle-global","sunscreen",{perStore:2});
        assert.equal(requests.length,2);
        assert.equal(requests[0].redirect,"manual");
        assert.equal(requests[1].redirect,"manual");
        assert.match(requests[0].url,/^https:\/\/www\.yesstyle\.com\/en\/list\.html\?/);
        assert.equal(requests[1].url,productUrl);
        for(const x of requests){
          assert.equal(x.headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
          assert.equal(x.headers["sec-ch-ua"],undefined);
        }
        assert.equal(r.candidates,1);
        assert.equal(r.offers.length,0);
        assert.equal(r.diagnostics.yesstyle.verifiedPdpCount,1);
        assert.equal(r.diagnostics.customerPublicationGate.customerPublishable,false);
      }finally{globalThis.fetch=previous}
    });
  });
test("302 redirect cannot become first-party evidence or trigger second request",
  {concurrency:false},async()=>{
    await enabled(async()=>{
      const previous=globalThis.fetch;
      let attempts=0;
      try{
        globalThis.fetch=async(_,init={})=>{
          attempts++;
          assert.equal(init.redirect,"manual");
          return new Response(null,{status:302,headers:{"location":"https://attacker.example/private"}});
        };
        const r=await searchFreeStorefrontById("yesstyle-global","sunscreen",{perStore:2});
        assert.equal(attempts,1);
        assert.equal(r.offers.length,0);
        assert.equal(r.diagnostics.yesstyle.verifiedPdpCount,0);
      }finally{globalThis.fetch=previous}
    });
  });
test("PDP returns 200 challenge shell: never verify price, stock or Saudi delivery",
  {concurrency:false},async()=>{
    await enabled(async()=>{
      const previous=globalThis.fetch;
      try{
        let calls=0;
        globalThis.fetch=async()=>{
          calls++;
          return new Response(calls===1?search:
            '<html><body class="neterror">Challenge</body></html>',{
              status:200,headers:{"content-type":"text/html"}
            });
        };
        const r=await searchFreeStorefrontById("yesstyle-global","sunscreen",{perStore:2});
        assert.equal(calls,2);
        assert.equal(r.diagnostics.yesstyle.verifiedPdpCount,0);
        assert.equal(r.offers.length,0);
      }finally{globalThis.fetch=previous}
    });
  });
