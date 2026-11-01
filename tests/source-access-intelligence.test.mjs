import test from "node:test";
import assert from "node:assert/strict";
import {
  classifySourceHttpStatus,
  classifySourceObservation,
  classifySourceError,
  parseRetryAfter,
  SourceHttpError,
  sourceRateLimitGuard,
  createSourceRateLimitGuard,
} from "../src/source-access-intelligence.mjs";
import { fetchAmazonSearchPages, searchFreeStorefrontById } from "../server/providers/free-storefronts.mjs";

test("source access: HTTP status taxonomy never implies out-of-stock",()=>{
  const cases=[
    [403,"HTTP_403_ACCESS_DENIED"],
    [404,"HTTP_404_RESOURCE_NOT_FOUND"],
    [410,"HTTP_410_RESOURCE_GONE"],
    [429,"HTTP_429_RATE_LIMITED"],
    [502,"HTTP_5XX_SOURCE_FAILURE"],
    [503,"HTTP_5XX_SOURCE_FAILURE"],
  ];
  for(const [status,expected] of cases){
    const value=classifySourceHttpStatus(status);
    assert.equal(value.failureClass,expected);
    assert.equal(value.productAvailability,"unknown");
    assert.equal(value.retryableNow,false);
  }
  assert.equal(classifySourceError(Object.assign(new Error("timed out"),{name:"TimeoutError"})).failureClass,"HTTP_TIMEOUT");
});

test("source access: HTTP 200 alone cannot claim valid catalog, price or inventory",()=>{
  assert.equal(classifySourceObservation({status:200,html:"<html><div id='root'></div><script src='/bundle.js'></script></html>",candidates:0,verifiedOffers:0}).failureClass,"HTTP_200_JS_SHELL");
  assert.equal(classifySourceObservation({status:200,blockedReason:"challenge",verifiedOffers:0}).failureClass,"HTTP_200_BLOCK_PAGE");
  assert.equal(classifySourceObservation({status:200,candidates:0,verifiedOffers:0,catalogObserved:true}).failureClass,"HTTP_200_EMPTY_CATALOG");
  assert.equal(classifySourceObservation({status:200,candidates:3,verifiedOffers:0,extractionFailed:true}).failureClass,"EXTRACTION_FAILURE");
  assert.equal(classifySourceObservation({status:200,redirectChanged:true,candidates:0,verifiedOffers:0}).failureClass,"HTTP_REDIRECT_CHANGED");
  assert.equal(classifySourceObservation({status:200,verifiedOffers:1}).failureClass,"VERIFIED_OFFER_AVAILABLE");
  assert.equal(classifySourceObservation({status:404}).productAvailability,"unknown");
});

test("source cooldown: Retry-After seconds/date strictly parsed; no negative, unbounded, or malformed delays",()=>{
  const now=Date.parse("2030-01-01T00:00:00.000Z");
  assert.equal(parseRetryAfter("120",{now}),120000);
  assert.equal(parseRetryAfter("Wed, 02 Jan 2030 00:00:00 GMT",{now}),86400000);
  assert.equal(parseRetryAfter("-3",{now}),null);
  assert.equal(parseRetryAfter("not-a-date",{now}),null);
  assert.equal(parseRetryAfter("99999999999999999999999999999",{now}),null);
  assert.equal(parseRetryAfter("0",{now}),0);
});

test("source cooldown: 429 source guard blocks repeat requests and honors Retry-After",()=>{
  let clock=1000;
  const guard=createSourceRateLimitGuard({now:()=>clock});
  guard.record429("merchant-a","120");
  assert.equal(guard.canRequest("merchant-a").allowed,false);
  assert.equal(guard.canRequest("merchant-a").retryAfterMs,120000);
  assert.equal(guard.canRequest("merchant-b").allowed,true);
  clock+=119999;
  assert.equal(guard.canRequest("merchant-a").allowed,false);
  clock+=1;
  assert.equal(guard.canRequest("merchant-a").allowed,true);
});

test("source cooldown: source HTTP error exports safe class without raw URL or inventory claims",()=>{
  const failure=new SourceHttpError(429,{retryAfterMs:120000});
  assert.equal(classifySourceError(failure).failureClass,"HTTP_429_RATE_LIMITED");
  assert.equal(failure.message,"HTTP 429");
  assert.equal(failure.productAvailability,"unknown");
  assert.equal(JSON.stringify(classifySourceError(failure)).includes("https://"),false);
});

test("source integration: one Lulu 429 with Retry-After blocks next same-source call, no IP/proxy retries",{concurrency:false},async()=>{
  const prior=globalThis.fetch;
  let calls=0;
  try{
    sourceRateLimitGuard.reset("lulu-sa");
    globalThis.fetch=async()=>{calls++;return new Response("Too Many Requests",{status:429,headers:{"retry-after":"120"}})};
    await assert.rejects(searchFreeStorefrontById("lulu-sa","iphone 17",{perStore:2}),/HTTP 429/);
    await assert.rejects(searchFreeStorefrontById("lulu-sa","iphone 17",{perStore:2}),/SOURCE_RATE_LIMIT_COOLDOWN/);
    assert.equal(calls,1,"rate-limited merchant must not be re-requested");
  }finally{globalThis.fetch=prior;sourceRateLimitGuard.reset("lulu-sa");}
});

test("source integration: a 404 remains an observed request failure and never locks source as out-of-stock",{concurrency:false},async()=>{
  const prior=globalThis.fetch;
  let calls=0;
  try{
    sourceRateLimitGuard.reset("lulu-sa");
    globalThis.fetch=async()=>{calls++;return new Response("Gone",{status:404,headers:{"content-type":"text/html"}})};
    await assert.rejects(searchFreeStorefrontById("lulu-sa","iphone 17",{perStore:2}),/HTTP 404/);
    await assert.rejects(searchFreeStorefrontById("lulu-sa","iphone 17",{perStore:2}),/HTTP 404/);
    assert.equal(calls,2,"404 is not a source-wide access cooldown");
  }finally{globalThis.fetch=prior;sourceRateLimitGuard.reset("lulu-sa");}
});

test("source integration: Amazon multi-page 429 does not retry; completed unrelated pages survive",async()=>{
  const hits=[];
  const result=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=iphone",{pageCount:2,deadlineMs:3000,
    fetchPage:async url=>{
      const page=Number(new URL(url).searchParams.get("page"));
      hits.push(page);
      if(page===2) throw new SourceHttpError(429,{retryAfterMs:180000});
      return {html:"<html>valid page 1</html>",finalUrl:url};
    },wait:async()=>{throw Error("429 must not schedule retry");}});
  assert.equal(result.length,1);
  assert.deepEqual(hits.sort(),[1,2]);
});

test("source guardrail: transient Amazon 503 may still retry once under the original deadline",async()=>{
  let attempts=0;
  const result=await fetchAmazonSearchPages("https://www.amazon.sa/s?k=iphone",{pageCount:1,deadlineMs:3000,
    fetchPage:async url=>{
      attempts++;
      if(attempts===1) throw new SourceHttpError(503);
      return {html:"<html>retry succeeded</html>",finalUrl:url};
    },wait:async()=>{}});
  assert.equal(attempts,2);
  assert.equal(result.length,1);
});


test("source safety: explicit 403 denies access without probing a different Virgin catalog endpoint", {concurrency:false}, async()=>{
  const previous=globalThis.fetch;
  let calls=0;
  try{
    sourceRateLimitGuard.reset("virgin-ae");
    globalThis.fetch=async()=>{
      calls++;
      return new Response("Forbidden",{status:403,headers:{"content-type":"text/html"}});
    };
    await assert.rejects(searchFreeStorefrontById("virgin-ae","airpods",{perStore:2}),/HTTP 403/);
    assert.equal(calls,1,"alternate category endpoint is not a bypass for a denied search");
  } finally {
    globalThis.fetch=previous;
    sourceRateLimitGuard.reset("virgin-ae");
  }
});


test("source diagnostics: 200 JS shell is not mistaken for an empty healthy catalog", {concurrency:false},async()=>{
  const previous=globalThis.fetch;
  let calls=0;
  try{
    sourceRateLimitGuard.reset("lulu-sa");
    globalThis.fetch=async()=>{
      calls++;
      return new Response("<html><div id='root'></div><script src='/assets/app.js'></script></html>",{
        status:200,headers:{"content-type":"text/html"}
      });
    };
    const result=await searchFreeStorefrontById("lulu-sa","iphone 17",{perStore:2});
    assert.equal(calls,1);
    assert.equal(result.offers.length,0);
    assert.equal(result.diagnostics.sourceObservation,"HTTP_200_JS_SHELL");
  }finally{globalThis.fetch=previous;sourceRateLimitGuard.reset("lulu-sa");}
});

test("source diagnostics: priced catalog candidates cannot be called PDP-verified offers",()=>{
  const result=classifySourceObservation({status:200,pricedCandidates:2,verifiedOffers:0,candidates:2});
  assert.equal(result.failureClass,"CATALOG_CANDIDATE_PRESENT");
  assert.equal(result.productAvailability,"unknown");
});

test("source guardrail: 403 must not attempt alternate Ikea catalog or second storefront probe",{concurrency:false},async()=>{
  const prior=globalThis.fetch;
  const hits=[];
  try{
    sourceRateLimitGuard.reset("ikea-sa");
    globalThis.fetch=async u=>{
      hits.push(String(u));
      return new Response("Forbidden",{status:403,headers:{"content-type":"text/html"}});
    };
    await assert.rejects(searchFreeStorefrontById("ikea-sa","chair",{perStore:2}),/HTTP 403/);
    assert.equal(hits.length,1);
  }finally{globalThis.fetch=prior;sourceRateLimitGuard.reset("ikea-sa");}
});

test("source guardrail: 403 and 429 never masquerade as out-of-stock or valid empty search",()=>{
  for (const status of [403,429]) {
    const classed=classifySourceHttpStatus(status);
    assert.equal(classed.productAvailability,"unknown");
    assert.notEqual(classed.failureClass,"HTTP_200_EMPTY_CATALOG");
    assert.equal(classed.retryableNow,false);
  }
});

test("R05: repeated explicit 403 denials trigger only bounded per-source cooldown",()=>{
  let clock=100_000;
  const guard=createSourceRateLimitGuard({now:()=>clock,denyThreshold:2,denyCooldownMs:10_000});
  assert.equal(guard.canRequest("lulu-sa").allowed,true);
  guard.record403("lulu-sa");
  assert.equal(guard.canRequest("lulu-sa").allowed,true,"first denial may be transient");
  assert.equal(guard.canRequest("jarir-direct").allowed,true,"one source may never poison another");
  guard.record403("lulu-sa");
  assert.deepEqual(guard.canRequest("lulu-sa"),{
    allowed:false,retryAfterMs:10_000,failureClass:"HTTP_403_ACCESS_DENIED",
  });
  clock+=9_999;
  assert.equal(guard.canRequest("lulu-sa").allowed,false);
  clock++;
  assert.equal(guard.canRequest("lulu-sa").allowed,true,"expired cooldown must probe again");
  guard.recordNon403("lulu-sa");
  guard.record403("lulu-sa");
  assert.equal(guard.canRequest("lulu-sa").allowed,true,
    "a confirmed recovery clears consecutive-denial history");
  guard.record403("lulu-sa");
  guard.reset("lulu-sa");
  assert.equal(guard.canRequest("lulu-sa").allowed,true);
});

test("R05: 429 Retry-After remains authoritative; 403 cannot weaken it",()=>{
  let clock=1000;
  const guard=createSourceRateLimitGuard({now:()=>clock,denyThreshold:2,denyCooldownMs:5000});
  guard.record403("test-source");
  guard.record429("test-source","120");
  assert.equal(guard.canRequest("test-source").retryAfterMs,120_000);
  assert.equal(guard.canRequest("test-source").failureClass,"HTTP_429_RATE_LIMITED");
  clock+=10_000;
  assert.equal(guard.canRequest("test-source").retryAfterMs,110_000);
  assert.equal(guard.canRequest("test-source").allowed,false);
});

test("R05: 403 circuit-breaker limits real storefront fetches but never re-labels failure",{
  concurrency:false,
},async()=>{
  const original=globalThis.fetch;
  let calls=0;
  try{
    sourceRateLimitGuard.reset("lulu-sa");
    globalThis.fetch=async()=>{calls++;return new Response("Forbidden",{
      status:403,headers:{"content-type":"text/html"}
    });};
    for(let i=0;i<2;i++){
      await assert.rejects(searchFreeStorefrontById("lulu-sa","iphone 17",{perStore:2}),/HTTP 403/);
    }
    await assert.rejects(searchFreeStorefrontById("lulu-sa","iphone 17",{perStore:2}),err=>
      err?.message==="SOURCE_ACCESS_DENIED_COOLDOWN" &&
      err?.failureClass==="HTTP_403_ACCESS_DENIED");
    assert.equal(calls,2,"blocked merchant must not generate a third request during cooldown");
  }finally{
    globalThis.fetch=original;
    sourceRateLimitGuard.reset("lulu-sa");
  }
});

test("R05: unrelated status never counts as access denial or global out-of-stock",()=>{
  const guard=createSourceRateLimitGuard();
  guard.record403("merchant-a");
  guard.recordNon403("merchant-a"); // 404/200/500 breaks consecutive 403 chain.
  guard.record403("merchant-a");
  assert.equal(guard.canRequest("merchant-a").allowed,true);
  assert.equal(guard.canRequest("merchant-b").allowed,true);
});
