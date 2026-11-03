import test from "node:test";
import assert from "node:assert/strict";
import {aggregateSourceErrorEvidence,mergeSourceErrorEvidence} from "../scripts/r04-source-failure-forensics.mjs";

test("R04-P3.6: per-source root cause classes preserve first-party market attribution",()=>{
  const summary=aggregateSourceErrorEvidence([
    {provider:"free-storefronts",sourceId:"free-storefronts",market:"noon-sa",failureClass:"HTTP_403_ACCESS_DENIED",error:"internal secret!"},
    {sourceId:"noon-sa",market:"noon-sa",failureClass:"HTTP_403_ACCESS_DENIED"},
    {sourceId:"virgin-ae",market:"virgin-ae",failureClass:"HTTP_TIMEOUT"},
    {sourceId:"search",error:"search_deadline_exceeded"},
  ]);
  assert.equal(summary.reported,4);
  assert.equal(summary.classified,4);
  assert.equal(summary.buckets.find(x=>x.sourceId==="noon-sa"&&x.failureClass==="HTTP_403_ACCESS_DENIED").count,2);
  assert.equal(summary.buckets.find(x=>x.sourceId==="virgin-ae").count,1);
  assert.equal(summary.buckets.find(x=>x.sourceId==="search").failureClass,"UNCLASSIFIED");
  assert.equal(JSON.stringify(summary).includes("secret"),false);
});

test("R04-P3.6: untrusted source names and raw diagnostic strings cannot leak into the audit artifact",()=>{
  const report=aggregateSourceErrorEvidence([
    {market:"https://user:pass@example.com/?secret=x",sourceId:"http://evil",failureClass:"SECRET_VALUE",error:"sk_test_secret"},
    {sourceId:"normal-market",failureClass:"INVENTED_SECRET_CLASS",error:"API_KEY=private"},
  ]);
  assert.equal(report.reported,2);
  assert.deepEqual(report.buckets,[
    {sourceId:"normal-market",failureClass:"UNCLASSIFIED",count:1},
    {sourceId:"unknown",failureClass:"UNCLASSIFIED",count:1},
  ]);
  assert.equal(JSON.stringify(report).includes("secret"),false);
  assert.equal(JSON.stringify(report).includes("private"),false);
});

test("R04-P3.6: per-source evidence is bounded while retaining exact observed event totals",()=>{
  const failures=Array.from({length:100},(_,i)=>({
    sourceId:"store-"+String(i).padStart(3,"0"),
    failureClass:"HTTP_TIMEOUT",
  }));
  const summary=aggregateSourceErrorEvidence(failures);
  assert.equal(summary.reported,100);
  assert.equal(summary.classified,100);
  assert.equal(summary.buckets.length,32);
  assert.equal(summary.otherEvents,68);
  const merged=mergeSourceErrorEvidence([summary,summary]);
  assert.equal(merged.reported,200);
  assert.equal(merged.classified,200);
  assert.equal(merged.otherEvents,136);
});

test("R04-P3.6: empty and malformed error collections cannot invent merchant outages",()=>{
  const empty=aggregateSourceErrorEvidence(null);
  assert.deepEqual(empty,{reported:0,classified:0,otherEvents:0,buckets:[]});
  assert.deepEqual(mergeSourceErrorEvidence([]),empty);
});
