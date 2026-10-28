import test from "node:test";
import assert from "node:assert/strict";
import {classifyFailure,attributeSourceFailures,aggregateFailureMatrices} from "../src/source-failure-attribution.mjs";

test("source error attribution distinguishes observed HTTP classes and ambiguities",()=>{
  assert.equal(classifyFailure({error:"HTTP 403"}),"HTTP_403_ACCESS_DENIED");
  assert.equal(classifyFailure({status:429,error:"merchant unavailable"}),"HTTP_429_RATE_LIMITED");
  assert.equal(classifyFailure({httpStatus:500}),"HTTP_5XX_SOURCE_FAILURE");
  assert.equal(classifyFailure({failureClass:"PRODUCT_IDENTITY_MISMATCH"}),"PRODUCT_IDENTITY_MISMATCH");
  assert.equal(classifyFailure({error:"connection timed out"}),"HTTP_TIMEOUT");
  assert.equal(classifyFailure({error:"HTTP 200 ok"}),"UNKNOWN");
  assert.equal(classifyFailure({error:"iPhone 403GB"}),"UNKNOWN");
  assert.equal(classifyFailure({error:"no results for offer"}),"UNKNOWN");
});
test("does not output tokens, URLs, raw merchant messages or unsafe source identifiers",()=>{
  const rows=attributeSourceFailures([
    {sourceId:"jarir-direct",error:"HTTP 403 https://private.host/?key=SECRET"},
    {sourceId:"jarir-direct",error:"HTTP 403 Token SECRET"},
    {sourceId:"https://token.example/internal",error:"network failure token=SECRET"},
  ],{query:"iPhone 17 256GB"});
  assert.equal(rows.eventCount,3);
  assert.equal(rows.matrix.find(x=>x.sourceId==="jarir-direct").events,2);
  assert.equal(rows.matrix.find(x=>x.sourceId==="unknown").failureClass,"UNKNOWN");
  assert.equal(rows.classifiedEvents+rows.unknownEvents,3);
  const json=JSON.stringify(rows);
  for(const needle of ["SECRET","private.host","token.example","https://"]) assert.ok(!json.includes(needle));
});
test("query labels fail closed and event totals are conserved across searches",()=>{
  const a=attributeSourceFailures([{sourceId:"jarir-direct",error:"HTTP 404"}, {sourceId:"jarir-direct",error:"HTTP 429"}],
    {query:"Galaxy S25"});
  const b=attributeSourceFailures([{sourceId:"jarir-direct",error:"Unknown breaking HTML"}],
    {query:"sensitive@example.com"});
  assert.equal(b.query,"unknown");
  const combined=aggregateFailureMatrices([a,b]);
  assert.equal(combined.eventCount,3);
  assert.equal(combined.classifiedEvents,2);
  assert.equal(combined.unknownEvents,1);
  assert.equal(combined.matrix.reduce((sum,row)=>sum+row.events,0),3);
  assert.equal(combined.distinctSourceIds,1);
});
test("missing and malformed provider fields stay unknown rather than invented",()=>{
  const report=attributeSourceFailures([null, {}, {sourceId:"noon-sa",error:{message:"HTTP 403"}}]);
  assert.equal(report.eventCount,3);
  assert.equal(report.unknownEvents,3);
  assert.equal(report.matrix.find(x=>x.sourceId==="noon-sa").failureClass,"UNKNOWN");
});

test("atomic storefront failures keep real merchant IDs and explicit source evidence",async()=>{
  const {storefrontSourceFailure}=await import("../src/storefront-error-evidence.mjs");
  const denied=storefrontSourceFailure("noon-sa","HTTP 403",{observedFailureClass:"HTTP_403_ACCESS_DENIED"});
  const noPdp=storefrontSourceFailure("amazon-uk","No verified structured-price product pages found",
    {observedFailureClass:"NO_VERIFIED_STRUCTURED_PRICE_PDP"});
  const timeout=storefrontSourceFailure("temu-global",new Error("store_deadline_exceeded:temu-global"));
  assert.equal(denied.sourceId,"noon-sa");
  assert.equal(denied.market,"noon-sa");
  assert.equal(denied.failureClass,"HTTP_403_ACCESS_DENIED");
  assert.equal(noPdp.failureClass,"NO_VERIFIED_STRUCTURED_PRICE_PDP");
  assert.equal(timeout.failureClass,"HTTP_TIMEOUT");
  const rows=attributeSourceFailures([denied,noPdp,timeout],{query:"PS5"});
  assert.equal(rows.eventCount,3);
  assert.equal(rows.unknownEvents,0);
  assert.deepEqual(new Set(rows.matrix.map(x=>x.sourceId)),
    new Set(["noon-sa","amazon-uk","temu-global"]));
});

test("real storefront classification never invents a successful price or shop status",async()=>{
  const {storefrontSourceFailure}=await import("../src/storefront-error-evidence.mjs");
  const e=storefrontSourceFailure("ikea-sa","generic backend exception");
  assert.equal(e.failureClass,"UNKNOWN");
  assert.equal(Object.hasOwn(e,"productPrice"),false);
  assert.equal(Object.hasOwn(e,"availability"),false);
  const network=storefrontSourceFailure("ikea-sa","fetch failed: ECONNRESET");
  assert.equal(network.failureClass,"SOURCE_TRANSPORT_FAILURE");
  assert.equal(classifyFailure(e),"UNKNOWN");
  assert.throws(()=>storefrontSourceFailure("https://foo.test/?token=secret","HTTP 403"),/INVALID_STOREFRONT_ID/);
  assert.throws(()=>storefrontSourceFailure("X-INVALID","HTTP 403"),/INVALID_STOREFRONT_ID/);
});

test("legacy aggregated errors use real market only when explicit and bounded",()=>{
  const report=attributeSourceFailures([
    {provider:"free-storefronts",sourceId:"free-storefronts",market:"shein-sa",error:"HTTP 403"},
    {provider:"free-storefronts",sourceId:"free-storefronts",market:"https://danger.example",error:"HTTP 403"},
    {sourceId:"jarir-direct",market:"other-store",error:"HTTP 404"},
  ]);
  assert.equal(report.eventCount,3);
  assert.equal(report.matrix.find(x=>x.sourceId==="shein-sa").failureClass,"HTTP_403_ACCESS_DENIED");
  assert.equal(report.matrix.find(x=>x.sourceId==="unknown").failureClass,"HTTP_403_ACCESS_DENIED");
  assert.equal(report.matrix.find(x=>x.sourceId==="jarir-direct").failureClass,"HTTP_404_RESOURCE_NOT_FOUND");
});

test("explicit structured evidence is preferred over message heuristics",async()=>{
  const {storefrontSourceFailure}=await import("../src/storefront-error-evidence.mjs");
  const e=storefrontSourceFailure("asos-global","generic failed request",
    {observedFailureClass:"HTTP_200_BLOCK_PAGE"});
  assert.equal(classifyFailure(e),"HTTP_200_BLOCK_PAGE");
  assert.equal(storefrontSourceFailure("asos-global","HTTP 403",
    {observedFailureClass:"UNRECOGNIZED"}).failureClass,"HTTP_403_ACCESS_DENIED");
});
