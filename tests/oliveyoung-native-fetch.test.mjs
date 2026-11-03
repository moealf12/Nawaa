import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {NAWAA_INDEXER_USER_AGENT} from "../src/source-http-profile.mjs";
const query="sunscreen";
const html='<html><head><title>Search | OLIVE YOUNG Global</title></head><body>'+
  "<main><h2>Results for 'sunscreen'</h2><p>1,301items</p>"+
  '<a href="/global/category/1000000011">Suncare</a></main></body></html>';
async function activated(fn){
  const beforeA=process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED;
  const beforeB=process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED;
  process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED="1";
  process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED="1";
  try{return await fn()}finally{
    if(beforeA===undefined)delete process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED;
    else process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED=beforeA;
    if(beforeB===undefined)delete process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED;
    else process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED=beforeB;
  }
}
test("authorized source issues exactly one same-origin, bounded user search and no PDP fanout",
  {concurrency:false},async()=>{
    await activated(async()=>{
      const previous=globalThis.fetch;const requests=[];
      try{
        globalThis.fetch=async(url,init={})=>{
          requests.push({url:String(url),init});
          return new Response(html,{status:200,headers:{"content-type":"text/html"}});
        };
        const r=await searchFreeStorefrontById("oliveyoung-global",query);
        assert.equal(requests.length,1);
        assert.equal(requests[0].url,"https://global.oliveyoung.com/global/search/results?query=sunscreen");
        assert.equal(requests[0].init.redirect,"manual");
        assert.equal(requests[0].init.headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
        assert.equal(requests[0].init.headers["sec-ch-ua"],undefined);
        assert.equal(r.offers.length,0);
        assert.equal(r.candidates,0);
        assert.equal(r.diagnostics.status,"SEARCH_DISCOVERY_UNAVAILABLE");
        assert.equal(r.diagnostics.oliveyoung.searchResultCount,1301);
        assert.equal(r.diagnostics.customerPublicationGate.customerPublishable,false);
        assert.equal(r.diagnostics.customerPublicationGate.shippingToSaudiVerified,false);
      }finally{globalThis.fetch=previous;}
    });
  });
test("HTTP 200 no-results shell cannot mean zero inventory or healthy empty catalog",
  {concurrency:false},async()=>{
    await activated(async()=>{
      const previous=globalThis.fetch;let calls=0;
      try{
        globalThis.fetch=async()=>{
          calls++;return new Response('<html><body>Popular Searches only</body></html>',{
            status:200,headers:{"content-type":"text/html"}
          });
        };
        const r=await searchFreeStorefrontById("oliveyoung-global",query);
        assert.equal(calls,1);
        assert.equal(r.diagnostics.status,"SEARCH_QUERY_EVIDENCE_MISSING");
        assert.deepEqual(r.offers,[]);
      }finally{globalThis.fetch=previous;}
    });
  });
test("off-origin 302 redirects never followed; no second fetch",
  {concurrency:false},async()=>{
    await activated(async()=>{
      const previous=globalThis.fetch;let calls=0;
      try{
        globalThis.fetch=async (_url,init={})=>{
          calls++;assert.equal(init.redirect,"manual");
          return new Response(null,{status:302,
            headers:{"location":"https://attacker.invalid/admin","content-type":"text/html"}});
        };
        const r=await searchFreeStorefrontById("oliveyoung-global",query);
        assert.equal(calls,1);
        assert.equal(r.offers.length,0);
        assert.ok(r.diagnostics.primarySearchError);
      }finally{globalThis.fetch=previous;}
    });
  });
test("HTTP 403 is a terminal denied request, no retry or substitute endpoint",
  {concurrency:false},async()=>{
    await activated(async()=>{
      const previous=globalThis.fetch;let calls=0;
      try{
        globalThis.fetch=async()=>{
          calls++;return new Response("Forbidden",{
            status:403,headers:{"content-type":"text/html"}});
        };
        await assert.rejects(searchFreeStorefrontById("oliveyoung-global",query));
        assert.equal(calls,1);
      }finally{globalThis.fetch=previous;}
    });
  });
