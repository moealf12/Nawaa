import test from "node:test";
import assert from "node:assert/strict";
import {createSearchCache,classifySearchCacheAdmission} from "../server/search-cache.mjs";

const offer=(merchant,price=100)=>({title:"Synthetic QA Product",merchant,productPrice:price,currency:"SAR"});
const complete=(offers=[offer("Jarir")])=>({
  offers,errors:[],coverage:{
    complete:true,partial:false,deadlineExceeded:false,providersPending:0,
    sourceFailures:{errorsReported:0},
  },
});
const partial=(offers=[offer("Jarir")])=>({
  offers,errors:[{sourceId:"extra-unbxd",error:"timeout"}],
  coverage:{complete:false,partial:true,deadlineExceeded:false,providersPending:0,
    sourceFailures:{errorsReported:1}},
});
const strict={classifyAdmission:result=>classifySearchCacheAdmission(result,{requireExplicitComplete:true})};

test("R02 RED: valid partial offers are returned but do not become fresh cache hits",async()=>{
  let calls=0;
  const search=createSearchCache(async()=>++calls===1?partial():complete([offer("Jarir"),offer("eXtra",99)]),strict);
  const a=await search("qa");
  assert.equal(a.offers.length,1);
  assert.equal(a.cache.mode,"miss");
  assert.equal(a.cache.completeness,"partial");
  const b=await search("qa");
  assert.equal(calls,2,"partial result must never suppress the next acquisition");
  assert.equal(b.cache.mode,"miss");
  assert.equal(b.cache.completeness,"complete");
  const c=await search("qa");
  assert.equal(calls,2);
  assert.equal(c.cache.mode,"fresh");
  assert.equal(c.cache.completeness,"complete");
});
test("R02 coverage missing or incomplete never enters strict cache",async()=>{
  let calls=0;
  const cache=createSearchCache(async()=>{calls++;return {offers:[offer("Jarir")],errors:[]}},strict);
  const a=await cache("qa");
  const b=await cache("qa");
  assert.equal(a.cache.completeness,"unknown");
  assert.equal(b.cache.mode,"miss");
  assert.equal(calls,2);
});
test("R02 inconsistent complete flags fail closed",()=>{
  for(const coverage of [
    {complete:true,partial:true},
    {complete:true,partial:false,deadlineExceeded:true},
    {complete:true,partial:false,providersPending:1},
    {complete:true,partial:false,providersPending:"unknown"},
    {complete:true,partial:false,sourceFailures:{errorsReported:1}},
    {complete:true,partial:false,sourceFailures:{errorsReported:"NaN"}},
  ]){
    assert.equal(classifySearchCacheAdmission({offers:[offer("Jarir")],errors:[],coverage},{requireExplicitComplete:true}).cacheable,false,JSON.stringify(coverage));
  }
});
test("R02 source failures cannot be promoted by complete flag",()=>{
  const x=complete();
  x.errors.push({sourceId:"amazon-sa",error:"HTTP 403"});
  assert.equal(classifySearchCacheAdmission(x,{requireExplicitComplete:true}).cacheable,false);
});
test("R02 classifier exception cannot drop buyer offers or cache the result",async()=>{
  let calls=0;
  const cache=createSearchCache(async()=>{calls++;return complete()},{
    classifyAdmission(){throw Error("classifier_broken");}
  });
  const a=await cache("qa");
  const b=await cache("qa");
  assert.equal(a.offers.length,1);
  assert.equal(a.cache.completeness,"unknown");
  assert.equal(b.cache.mode,"miss");
  assert.equal(calls,2);
});
test("R02 partial refresh never overwrites last complete snapshot",async()=>{
  let now=0,calls=0;
  const cache=createSearchCache(async()=>++calls===1?complete([offer("Jarir"),offer("eXtra")]):partial(),{
    ...strict,ttl:45,staleTtl:300,now:()=>now,
  });
  assert.equal((await cache("qa")).offers.length,2);
  now=46;
  const response=await cache("qa",{allowStale:false});
  assert.equal(response.offers.length,1);
  assert.equal(response.cache.completeness,"partial");
  assert.equal(cache.peek("qa").offers.length,2);
  assert.equal(cache.peek("qa").cache.mode,"stale");
  assert.equal(cache.peek("qa",{allowStale:false}),null);
});
test("R02 identical concurrent partial requests still coalesce, sequential retry proceeds",async()=>{
  let calls=0,release;
  const gate=new Promise(resolve=>release=resolve);
  const cache=createSearchCache(async()=>{calls++;await gate;return partial()},strict);
  const pending=Array.from({length:30},()=>cache("qa",{allowStale:false}));
  release();
  const results=await Promise.all(pending);
  assert.equal(calls,1);
  assert.ok(results.every(x=>x.offers.length===1&&x.cache.completeness==="partial"));
  await cache("qa",{allowStale:false});
  assert.equal(calls,2);
});
test("R02 rejected partial result exposes only low-cardinality admission reason",async()=>{
  let diagnostic;
  const cache=createSearchCache(async()=>partial(),strict);
  const response=await cache("private-query",{allowStale:false,onDiagnostic:x=>diagnostic=x});
  assert.equal(response.offers.length,1);
  assert.equal(diagnostic.cacheAdmission,"rejected");
  assert.equal(diagnostic.completeness,"partial");
  assert.equal(diagnostic.cacheAdmissionReason,"coverage_partial");
  assert.equal(JSON.stringify(diagnostic).includes("private-query"),false);
});
test("R02 invalidation trace describes final replacement admission",async()=>{
  let firstStarted,call=0;
  const started=new Promise(resolve=>firstStarted=resolve);
  let diag;
  const cache=createSearchCache(async()=>{
    if(++call===1){firstStarted();await new Promise(()=>{});}
    return complete();
  },strict);
  const p=cache("qa",{allowStale:false,onDiagnostic:x=>diag=x});
  await started;
  cache.clear("ingest");
  const result=await p;
  assert.equal(result.offers.length,1);
  assert.equal(result.cache.completeness,"complete");
  assert.equal(diag.refreshReplays,1);
  assert.equal(diag.lastInvalidationReason,"ingest");
  assert.equal(diag.cacheAdmission,"accepted");
});
test("R02 explicit complete is scoped to a selected acquisition wave, not exhaustive global recall",()=>{
  const value=complete();
  value.coverage.exhaustive=false;
  value.coverage.moreAvailable=true;
  assert.equal(classifySearchCacheAdmission(value,{requireExplicitComplete:true}).cacheable,true);
});
