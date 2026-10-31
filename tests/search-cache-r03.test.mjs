import test from "node:test";
import assert from "node:assert/strict";
import {createSearchCache,classifySearchCacheAdmission} from "../server/search-cache.mjs";

const completed=(id)=>({offers:[{id}],errors:[],coverage:{
  complete:true,partial:false,deadlineExceeded:false,providersPending:0,
  sourceFailures:{errorsReported:0},
}});
const empty=()=>({offers:[],errors:[],coverage:{
  complete:true,partial:false,deadlineExceeded:false,providersPending:0,
  sourceFailures:{errorsReported:0},
}});
const strict={classifyAdmission:result=>classifySearchCacheAdmission(result,{requireExplicitComplete:true})};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};

test("R03 RED: revoked expired snapshot never resurrects through stale-if-error",async()=>{
  let now=0,calls=0;
  const old=deferred(),replacement=deferred();
  const cache=createSearchCache(()=>{
    if(++calls===1)return completed("deleted");
    if(calls===2)return old.promise;
    if(calls===3)return replacement.promise;
    throw Error("unexpected acquisition");
  },{...strict,now:()=>now,ttl:10,staleTtl:100});
  await cache("PS5");
  now=101;
  const shopper=cache("PS5");
  await drain();
  assert.equal(calls,2);
  cache.clear("ebay_deletion");
  await drain();
  assert.equal(calls,3);
  replacement.resolve(empty());
  const result=await shopper;
  assert.deepEqual(result.offers,[],"invalidation revoked the prior snapshot");
  assert.notEqual(result.cache.mode,"stale-if-error");
  old.resolve(completed("deleted"));
  await drain();
  assert.equal(cache.stats().entries,0);
});

test("R03: ordinary stale-if-error remains available without invalidation",async()=>{
  let now=0,calls=0;
  const cache=createSearchCache(()=>++calls===1?completed("valid"):empty(),
    {...strict,now:()=>now,ttl:10,staleTtl:100});
  await cache("phone");now=101;
  const result=await cache("phone");
  assert.equal(result.cache.mode,"stale-if-error");
  assert.deepEqual(result.offers,[{id:"valid"}]);
});

test("R03: 100 simultaneous cache misses coalesce to one acquisition",async()=>{
  let calls=0;
  const gate=deferred();
  const cache=createSearchCache(()=>{calls++;return gate.promise},strict);
  const shoppers=Array.from({length:100},()=>cache("same"));
  await drain();
  assert.equal(calls,1);
  assert.equal(cache.stats().pending,1);
  gate.resolve(completed("current"));
  const results=await Promise.all(shoppers);
  assert.equal(results.length,100);
  assert.ok(results.every(r=>r.offers[0].id==="current"));
  assert.equal(cache.stats().pending,0);
});

test("R03: 50 old waiters replay onto one replacement, not obsolete results",async()=>{
  let calls=0;
  const old=deferred(),replacement=deferred();
  const cache=createSearchCache(()=>++calls===1?old.promise:replacement.promise,strict);
  const shoppers=Array.from({length:50},()=>cache("shared",{allowStale:false}));
  await drain();
  assert.equal(calls,1);
  cache.clear("ingest");
  await drain();
  assert.equal(calls,2);
  replacement.resolve(completed("new"));
  const results=await Promise.all(shoppers);
  assert.ok(results.every(r=>r.offers[0].id==="new"));
  old.resolve(completed("obsolete"));
  await drain();
  assert.equal((await cache("shared")).offers[0].id,"new");
});

test("R02 guard: depth 0/1/2 partial offers remain visible but not cacheable",async()=>{
  for(const depth of [0,1,2]){
    let calls=0;
    const partial=completed("partial-"+depth);
    partial.coverage.complete=false;
    partial.coverage.partial=true;
    partial.coverage.providersPending=1;
    const cache=createSearchCache(()=>++calls===1?partial:completed("complete-"+depth),strict);
    const first=await cache("amazon:"+depth);
    assert.equal(first.cache.mode,"miss");
    assert.equal(first.offers[0].id,"partial-"+depth);
    assert.equal(cache.stats().entries,0);
    const next=await cache("amazon:"+depth);
    assert.equal(next.offers[0].id,"complete-"+depth);
    assert.equal(calls,2);
    assert.equal(cache.stats().entries,1);
  }
});

test("R02 guard: inconsistent source completeness cannot enter cache",()=>{
  for(const mutate of [
    c=>{c.coverage.providersPending=1},
    c=>{c.coverage.sourceFailures.errorsReported=1},
    c=>{c.coverage.deadlineExceeded=true},
  ]){
    const c=completed("test");
    mutate(c);
    assert.equal(strict.classifyAdmission(c).cacheable,false);
  }
});
