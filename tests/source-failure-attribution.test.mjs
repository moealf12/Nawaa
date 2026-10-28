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
