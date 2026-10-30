import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createSearchCache} from "../server/search-cache.mjs";

test("an invalidation during search preserves freshness and reports exactly one replay",async()=>{
  let releaseFirst,markFirstStarted,calls=0,trace=null;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
  const firstStarted=new Promise(resolve=>{markFirstStarted=resolve;});
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1){
      markFirstStarted();
      await firstGate;
      return {offers:[{title:"old",productPrice:10}],errors:[]};
    }
    return {offers:[{title:"new",productPrice:20}],errors:[]};
  });
  const request=cache("iPhone 17",{allowStale:false,
    onDiagnostic:info=>{trace=info;},
  });
  assert.equal(cache.isPending("iPhone 17"),true);
  // Wait for the first acquisition to begin. Invalidation before the search
  // starts is NOT an in-flight replay, and must not be misclassified as one.
  await firstStarted;
  cache.clear();
  releaseFirst();
  const result=await request;
  assert.equal(calls,2,"invalidation must trigger a fresh second search");
  assert.deepEqual(result.offers,[{title:"new",productPrice:20}]);
  assert.deepEqual(trace,{refreshReplays:1,lastInvalidationReason:"unknown"});
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
  assert.deepEqual(diagA,{refreshReplays:0,lastInvalidationReason:null});
  assert.deepEqual(diagB,{refreshReplays:0,lastInvalidationReason:null});
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

test("in-flight invalidation returns fresh evidence before obsolete search settles",async()=>{
  let started,release, calls=0,diagnostic;
  const firstStarted=new Promise(resolve=>{started=resolve;});
  const neverDone=new Promise(resolve=>{release=resolve;});
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1){started();await neverDone;return {offers:[{title:"revoked",productPrice:10}]};}
    return {offers:[{title:"current",productPrice:11}]};
  });
  const first=cache("a",{allowStale:false,onDiagnostic:x=>{diagnostic=x;}});
  await firstStarted;
  cache.clear("ingest");
  const second=cache("a",{allowStale:false});
  const outcome=await Promise.race([Promise.all([first,second]),new Promise((_,reject)=>setTimeout(()=>reject(Error("obsolete search blocked replacement")),1500))]);
  assert.equal(calls,2);
  assert.equal(outcome[0].offers[0].title,"current");
  assert.deepEqual(outcome[0].offers,outcome[1].offers);
  assert.deepEqual(diagnostic,{refreshReplays:1,lastInvalidationReason:"ingest"});
  release();
});

test("two invalidations chain to newest generation without releasing older acquisitions",async()=>{
  let calls=0,startedFirst,startedSecond,releaseFirst,releaseSecond,diagnostic;
  const one=new Promise(resolve=>{releaseFirst=resolve;});
  const two=new Promise(resolve=>{releaseSecond=resolve;});
  const firstStarted=new Promise(resolve=>{startedFirst=resolve;});
  const secondStarted=new Promise(resolve=>{startedSecond=resolve;});
  const cache=createSearchCache(async()=>{
    const index=++calls;
    if(index===1){startedFirst();await one;}
    if(index===2){startedSecond();await two;}
    return {offers:[{title:"gen"+index,productPrice:index}]};
  });
  const request=cache("PS5",{allowStale:false,onDiagnostic:x=>{diagnostic=x;}});
  await firstStarted;cache.clear("ingest");
  await secondStarted;cache.clear("ebay_deletion");
  const response=await Promise.race([request,new Promise((_,reject)=>setTimeout(()=>reject(Error("still waiting on obsolete generation")),1500))]);
  assert.equal(calls,3);
  assert.equal(response.offers[0].title,"gen3");
  assert.deepEqual(diagnostic,{refreshReplays:2,lastInvalidationReason:"ebay_deletion"});
  releaseFirst();releaseSecond();
});

test("obsolete search rejection after invalidation is observed and cannot break current offers",async()=>{
  let rejectOld,started;
  const firstStarted=new Promise(resolve=>{started=resolve;});
  const old=new Promise((_,reject)=>{rejectOld=reject;});
  let calls=0;
  const cache=createSearchCache(async()=>{
    if(++calls===1){started();return old;}
    return {offers:[{title:"live",productPrice:1}]};
  });
  const request=cache("query",{allowStale:false});
  await firstStarted;cache.clear("ingest");
  const result=await request;
  rejectOld(Error("old remote request failed"));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(result.offers[0].title,"live");
});

test("one shared replacement serves many subscribers and does not publish stale results",async()=>{
  let started,releaseOld,calls=0;
  const startedPromise=new Promise(resolve=>{started=resolve;});
  const old=new Promise(resolve=>{releaseOld=resolve;});
  const cache=createSearchCache(async()=>{
    const index=++calls;
    if(index===1){started();await old;}
    return {offers:[{title:index===1?"old":"fresh",productPrice:index}]};
  });
  const readers=Array.from({length:25},()=>cache("iPhone",{allowStale:false}));
  await startedPromise;
  cache.clear("ingest");
  const after=Array.from({length:25},()=>cache("iPhone",{allowStale:false}));
  const results=await Promise.all([...readers,...after]);
  assert.equal(calls,2);
  assert.equal(results.length,50);
  assert.ok(results.every(x=>x.offers[0].title==="fresh"));
  releaseOld();
});

test("invalidation aborts only the obsolete acquisition, preserving the replacement",async()=>{
  let started,oldSignal,calls=0;
  const begun=new Promise(resolve=>{started=resolve;});
  const cache=createSearchCache(async(_key,{signal}={})=>{
    calls++;
    if(calls===1){
      oldSignal=signal;started();
      await new Promise((_,reject)=>{
        if(signal.aborted)return reject(signal.reason);
        signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
      });
    }
    assert.equal(signal.aborted,false,"current generation must never inherit obsolete abort");
    return {offers:[{title:"fresh",productPrice:55}]};
  });
  const first=cache("laptop",{allowStale:false});
  await begun;
  cache.clear("ingest");
  const result=await first;
  assert.equal(oldSignal.aborted,true);
  assert.equal(result.offers[0].title,"fresh");
  assert.equal(calls,2);
});
