import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createSearchCache} from "../server/search-cache.mjs";

test("an invalidation during search preserves freshness and reports exactly one replay",async()=>{
  let releaseFirst,calls=0,trace=null;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1){await firstGate;return {offers:[{title:"old",productPrice:10}],errors:[]};}
    return {offers:[{title:"new",productPrice:20}],errors:[]};
  });
  const request=cache("iPhone 17",{allowStale:false,
    onDiagnostic:info=>{trace=info;},
  });
  assert.equal(cache.isPending("iPhone 17"),true);
  cache.clear();
  releaseFirst();
  const result=await request;
  assert.equal(calls,2,"invalidation must trigger a fresh second search");
  assert.deepEqual(result.offers,[{title:"new",productPrice:20}]);
  assert.deepEqual(trace,{refreshReplays:1});
  assert.equal(cache.isPending("iPhone 17"),false);
});

test("normal coalesced requests report zero replay without changing results",async()=>{
  let release,calls=0,diagA,diagB;
  const gate=new Promise(resolve=>{release=resolve;});
  const cache=createSearchCache(async()=>{
    calls++;
    await gate;
    return {offers:[{title:"PS5",productPrice:2000}],errors:[]};
  });
  const a=cache("PS5",{allowStale:false,onDiagnostic:x=>{diagA=x;}});
  const b=cache("PS5",{allowStale:false,onDiagnostic:x=>{diagB=x;}});
  release();
  const [x,y]=await Promise.all([a,b]);
  assert.deepEqual(x.offers,y.offers);
  assert.equal(calls,1);
  assert.deepEqual(diagA,{refreshReplays:0});
  assert.deepEqual(diagB,{refreshReplays:0});
});

test("cache diagnostics never turn eligible offers into errors",async()=>{
  const cache=createSearchCache(async()=>({
    offers:[{title:"JBL Headphones",productPrice:100}],errors:[]
  }));
  const result=await cache("headphones",{allowStale:false,onDiagnostic:()=>{
    throw new Error("broken telemetry");
  }});
  assert.equal(result.offers[0].productPrice,100);
});

test("four independent acquisition barriers and cache replay are recorded without modifying offers",()=>{
  const code=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  for(const name of ["amazon-sa","provider-pass","meilisearch","persisted"])
    assert.ok(code.includes('observeBarrier("'+name+'",'));
  assert.match(code,/primaryComponents,/);
  assert.match(code,/cacheRefreshReplays=diag.refreshReplays/);
  assert.match(code,/cacheRefreshReplays,/);
});
