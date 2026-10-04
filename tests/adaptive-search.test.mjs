import test from "node:test";
import assert from "node:assert/strict";
import { createSearchCache } from "../server/search-cache.mjs";
import { createSourceReliabilityEngine } from "../server/source-reliability.mjs";

test("search cache serves stale immediately and coalesces background refresh",async()=>{
  let now=0,calls=0,release;
  const search=async()=>{calls++;if(calls===2)await new Promise(r=>release=r);return {offers:[{id:calls}],errors:[]};};
  const cache=createSearchCache(search,{ttl:100,staleTtl:1000,now:()=>now});
  assert.equal((await cache("hp")).cache.mode,"miss");
  now=200;
  const stale=await cache("hp");
  assert.equal(stale.cache.mode,"stale");
  assert.equal(stale.offers[0].id,1);
  await Promise.resolve();
  assert.equal(calls,2);
  const staleAgain=await cache("hp");
  assert.equal(staleAgain.offers[0].id,1);
  assert.equal(calls,2);
  release();
  await cache.refresh("hp");
  assert.equal((await cache("hp")).offers[0].id,2);
});

test("source routing score rewards fast productive sources",()=>{
  let now=0;
  const engine=createSourceReliabilityEngine({now:()=>now});
  for(let i=0;i<8;i++){engine.record("fast",{transportOk:true,offers:10,latencyMs:300});engine.record("slow",{transportOk:true,offers:1,latencyMs:5000});now+=10;}
  assert.ok(engine.routingScore("fast")>engine.routingScore("slow"));
  assert.deepEqual(engine.rank(["slow","fast"]),["fast","slow"]);
});
