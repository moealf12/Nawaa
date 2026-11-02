import test from "node:test";
import assert from "node:assert/strict";
import {classifySearchCacheAdmission,createSearchCache} from "../server/search-cache.mjs";

const validOffer={title:"HP Pavilion 16GB RAM",merchant:"eXtra",productPrice:2799,currency:"SAR"};
const covered=(change={})=>({
  offers:[validOffer],errors:[],coverage:{
    complete:true,partial:false,deadlineExceeded:false,providersPending:0,
    sourceFailures:{errorsReported:0},
    ...change,
  },
});
const strict={classifyAdmission:result=>classifySearchCacheAdmission(result,{requireExplicitComplete:true})};

test("R06-C RED: missing providersPending cannot certify a complete cache entry",()=>{
  const result=covered();delete result.coverage.providersPending;
  const verdict=classifySearchCacheAdmission(result,{requireExplicitComplete:true});
  assert.equal(verdict.cacheable,false,"missing provider evidence must not become 0");
  assert.equal(verdict.completeness,"unknown");
  assert.equal(verdict.reason,"coverage_invalid");
});

test("R06-C: malformed providersPending fails closed even when complete is asserted",()=>{
  for(const pending of [undefined,null,-1,1.5,"0",Infinity,NaN,{},true]){
    const result=covered({providersPending:pending});
    const verdict=classifySearchCacheAdmission(result,{requireExplicitComplete:true});
    assert.equal(verdict.cacheable,false,JSON.stringify({pending,verdict}));
  }
});

test("R06-C: genuine wave-complete source evidence with explicit pending zero remains cacheable",()=>{
  const verdict=classifySearchCacheAdmission(covered(),{requireExplicitComplete:true});
  assert.deepEqual(verdict,{cacheable:true,completeness:"complete",reason:"complete_result"});
});

test("R06-C: missing pending evidence preserves offers but cannot suppress next merchant refresh",async()=>{
  let calls=0;
  const search=createSearchCache(async()=>{
    calls++;
    if(calls===1){
      const first=covered();
      delete first.coverage.providersPending;
      return first;
    }
    return covered();
  },strict);
  const first=await search("hp laptop",{allowStale:false});
  assert.equal(first.offers[0].productPrice,2799);
  assert.equal(first.cache.mode,"miss");
  assert.equal(first.cache.completeness,"unknown");
  const second=await search("hp laptop",{allowStale:false});
  assert.equal(calls,2,"unverified source wave must not become a cache hit");
  assert.equal(second.cache.mode,"miss");
  assert.equal(second.cache.completeness,"complete");
  const third=await search("hp laptop",{allowStale:false});
  assert.equal(third.cache.mode,"fresh");
  assert.equal(calls,2);
});

test("R06-C: known pending provider never becomes complete cache even with valid offers",()=>{
  const verdict=classifySearchCacheAdmission(covered({providersPending:1}),{requireExplicitComplete:true});
  assert.equal(verdict.cacheable,false);
  assert.equal(verdict.completeness,"unknown");
  assert.equal(verdict.reason,"coverage_conflict");
});
