import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {retryDeniedStorefrontIds,providersPendingAfterFallback,genericStorefrontPassExclusions} from "../server/source-fallback-policy.mjs";

const available=new Set(["noon-sa","amazon-ae","virgin-ae","lulu-sa","nike-sa","extra-unbxd"]);

test("R04-P3.6: only verified hard denial/rate limiting from a registered storefront prevents immediate same-request fallback replay",()=>{
  const failures=[
    {sourceId:"noon-sa",market:"noon-sa",failureClass:"HTTP_403_ACCESS_DENIED",error:"HTTP 403"},
    {sourceId:"amazon-ae",market:"amazon-ae",failureClass:"HTTP_429_RATE_LIMITED",error:"HTTP 429"},
    {sourceId:"virgin-ae",market:"virgin-ae",failureClass:"HTTP_TIMEOUT",error:"timed out"},
    {sourceId:"lulu-sa",market:"lulu-sa",failureClass:"NO_VERIFIED_STRUCTURED_PRICE_PDP",error:"unverified"},
    {sourceId:"nike-sa",market:"nike-sa",failureClass:"HTTP_5XX_SOURCE_FAILURE",error:"HTTP 503"},
    {sourceId:"extra-unbxd",provider:"extra-unbxd",failureClass:"HTTP_403_ACCESS_DENIED",error:"HTTP 403"},
  ];
  assert.deepEqual(retryDeniedStorefrontIds(failures,{registeredIds:available}),["amazon-ae","noon-sa"]);
});

test("R04-P3.6: unsupported, untrusted, malformed and only inferred errors never suppress discovery",()=>{
  const failures=[
    {sourceId:"noon-sa",market:"noon-sa",error:"HTTP 403"},
    {sourceId:"noon-sa",market:"noon-sa",failureClass:"UNKNOWN",error:"HTTP 403"},
    {sourceId:"amazon-ae",market:"amazon-ae",failureClass:"HTTP_403_ACCESS_DENIED",error:"blocked"},
    {sourceId:"unknown-site",market:"unknown-site",failureClass:"HTTP_403_ACCESS_DENIED"},
    {provider:"extra-unbxd",sourceId:"extra-unbxd",market:"nike-sa",failureClass:"HTTP_403_ACCESS_DENIED"},
    {sourceId:"free-storefronts",market:"nike-sa",failureClass:"HTTP_TIMEOUT"},
    {sourceId:"free-storefronts",market:"lulu-sa",failureClass:"HTTP_403_ACCESS_DENIED"},
    {sourceId:"noon-sa",market:"noon-sa",failureClass:"HTTP_403_ACCESS_DENIED"},
  ];
  assert.deepEqual(retryDeniedStorefrontIds(failures,{registeredIds:available}),["amazon-ae","lulu-sa","noon-sa"]);
  assert.deepEqual(retryDeniedStorefrontIds([], {registeredIds:available}),[]);
  assert.deepEqual(retryDeniedStorefrontIds(null, {registeredIds:available}),[]);
});

test("R04-P3.6: same-request non-retry neither removes primary errors nor makes irreversible cross-request changes",()=>{
  const failures=[{sourceId:"noon-sa",market:"noon-sa",failureClass:"HTTP_403_ACCESS_DENIED",error:"HTTP 403"}];
  const copy=structuredClone(failures);
  assert.deepEqual(retryDeniedStorefrontIds(failures,{registeredIds:available}),["noon-sa"]);
  assert.deepEqual(failures,copy);
  assert.deepEqual(retryDeniedStorefrontIds([],{registeredIds:available}),[]);
});

test("R04-P3.6: fallback alone is source-scoped; first-wave collection, Amazon and cursor routing stay unchanged",()=>{
  const server=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  assert.match(server,/skipFailedStorefrontIds\s*=\s*\[\]/);
  assert.match(server,/excludeStoreIds:genericStorefrontPassExclusions\(skipFailedStorefrontIds/);
  assert.match(server,/retryDeniedStorefrontIds\(primary\.errors/);
  assert.match(server,/skipFailedStorefrontIds:\s*retryDeniedIds/);
  assert.match(server,/runProviderPass\(providerQuery,\s*"primary"/);
  assert.match(server,/amazonPageCount:plan\.amazonPageCount/);
});

test("R04 P42 stopped fallback never claims all providers completed",()=>{
  const abort=[{provider:"search",sourceId:"search",pass:"fallback",error:"fallback_budget_limited"}];
  assert.equal(providersPendingAfterFallback(abort),null);
  assert.equal(providersPendingAfterFallback(abort,{deadlineExceeded:true}),null);
  assert.equal(providersPendingAfterFallback([],{deadlineExceeded:true}),null);
  assert.equal(providersPendingAfterFallback([]),0);
  assert.equal(providersPendingAfterFallback([{pass:"primary",error:"HTTP 403"}]),0);
  assert.equal(providersPendingAfterFallback([{pass:"primary",error:"fallback_budget_limited"}]),0);
});


test("R04-P44: direct Virgin and Amazon are never duplicated in generic source fanout",()=>{
  const observedFailures=["noon-sa","noon-sa","virgin-ae","untrusted-merchant"];
  const copy=[...observedFailures];
  const excluded=genericStorefrontPassExclusions(observedFailures,{registeredIds:available});
  assert.deepEqual(excluded,["amazon-sa","virgin-ae","noon-sa"]);
  assert.deepEqual(observedFailures,copy,"exclusion policy must be pure and request-scoped");
  assert.deepEqual(genericStorefrontPassExclusions([]),["amazon-sa","virgin-ae"]);
  assert.deepEqual(genericStorefrontPassExclusions(null),["amazon-sa","virgin-ae"]);
});

test("R04-P44: generic first wave backfills excluded Virgin from ranked merchants without dropping eligible merchant breadth",async()=>{
  const {routeFreeStorefronts,configuredFreeStorefronts}=await import("../server/providers/free-storefronts.mjs");
  const {acquisitionPlan}=await import("../server/search-cursor.mjs");
  const plan=acquisitionPlan(0,configuredFreeStorefronts().length);
  for(const query of ["iPhone 17","PS5","Dior perfume","Nike running shoes","Apple Watch Series 11"]){
    const routes=routeFreeStorefronts(query,Infinity,{stable:true});
    const genericExclusions=new Set(genericStorefrontPassExclusions([]));
    const generic=routes.filter(r=>!genericExclusions.has(r.store.id)).slice(0,plan.storefrontLimit);
    const prior=routes.filter(r=>r.store.id!=="amazon-sa").slice(0,plan.storefrontLimit);
    const merchantIds=generic.map(r=>r.store.id);
    assert.equal(new Set(merchantIds).size,merchantIds.length,
      "duplicate generic merchant for "+query);
    assert.ok(!merchantIds.includes("virgin-ae")&&!merchantIds.includes("amazon-sa"));
    assert.equal(generic.length,
      Math.min(plan.storefrontLimit,routes.filter(r=>!genericExclusions.has(r.store.id)).length),
      "excluded merchant slot must be backfilled if an eligible store remains");
    const priorDistinct=new Set([...prior.map(r=>r.store.id),"virgin-ae"]);
    const nowDistinct=new Set([...merchantIds,"virgin-ae"]);
    assert.ok(nowDistinct.size>=priorDistinct.size,
      "exclusion must not decrease total first-wave merchant diversity for "+query);
  }
});

test("R04-P44: dedicated Virgin acquisition cannot be erased by generic exclusion",()=>{
  const server=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  assert.match(server,/add\("virgin-ae", \(signal\) => searchFreeStorefrontById\("virgin-ae"/);
  assert.match(server,/productPageLimit:8/);
  assert.match(server,/storeDeadlineMs:7000/);
  assert.match(server,/excludeStoreIds:genericStorefrontPassExclusions/);
});
