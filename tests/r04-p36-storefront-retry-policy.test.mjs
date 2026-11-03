import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {retryDeniedStorefrontIds} from "../server/source-fallback-policy.mjs";

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
  assert.match(server,/excludeStoreIds:\["amazon-sa",\.\.\.skipFailedStorefrontIds\]/);
  assert.match(server,/retryDeniedStorefrontIds\(primary\.errors/);
  assert.match(server,/skipFailedStorefrontIds:\s*retryDeniedIds/);
  assert.match(server,/runProviderPass\(providerQuery,\s*"primary"/);
  assert.match(server,/amazonPageCount:plan\.amazonPageCount/);
});
