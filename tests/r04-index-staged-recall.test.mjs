import test from "node:test";
import assert from "node:assert/strict";
import {
  INDEX_RECALL_BUDGET, INDEX_RECALL_TIMEOUT_MS, INDEX_OBSERVATION_TTL_MS,
  indexRecallPlan,validateIndexPage,filterFreshIndexedHits,
  compactIndexRecallEvidence,
} from "../server/index-recall-plan.mjs";

const now=Date.parse("2026-11-03T10:00:00Z");
const hit=(i,extra={})=>({
  title:"iPhone 17 256GB SKU "+i,
  sourceUrl:"https://valid-merchant.example/p/"+i,
  merchant:"Fixture Store",productPrice:4000+i,currency:"SAR",
  observedAt:new Date(now-10_000).toISOString(),
  matchConfidence:1,exactMatch:true,
  ...extra,
});
test("R04 P2: initial 80 and depth-1/2 offset windows cover exactly 1000 indexed positions",()=>{
  const first=validateIndexPage({limit:80,offset:0});
  const second=indexRecallPlan(1),third=indexRecallPlan(2);
  assert.deepEqual(second,{offset:80,limit:420});
  assert.deepEqual(third,{offset:500,limit:500});
  assert.equal(INDEX_RECALL_BUDGET,1000);
  assert.ok(INDEX_RECALL_TIMEOUT_MS<=1000);
  const offsets=[first,second,third].flatMap(({offset,limit})=>
    Array.from({length:limit},(_,i)=>offset+i));
  assert.equal(offsets.length,1000);
  assert.equal(new Set(offsets).size,1000);
  assert.equal(Math.min(...offsets),0);
  assert.equal(Math.max(...offsets),999);
  for(const page of [{offset:-1,limit:80},{offset:1000,limit:1},
    {offset:500,limit:501},{offset:999,limit:2},{offset:0,limit:0},
    {offset:0,limit:Infinity},{offset:NaN,limit:1}])
    assert.throws(()=>validateIndexPage(page),/invalid_index_page/);
  assert.throws(()=>indexRecallPlan(0),/invalid_index_recall_depth/);
  assert.throws(()=>indexRecallPlan(3),/invalid_index_recall_depth/);
});
test("R04 P2: only source-observed fresh hits survive; query-time exactness is reset",()=>{
 const hits=[hit(0),hit(1,{observedAt:new Date(now-INDEX_OBSERVATION_TTL_MS-1).toISOString()}),
   hit(2,{observedAt:new Date(now+60_001).toISOString()}),
   hit(3,{observedAt:"tomorrow"}),hit(4,{title:""}),
   hit(5,{sourceUrl:""}),hit(6,{observedAt:new Date(now-INDEX_OBSERVATION_TTL_MS).toISOString()})];
 const out=filterFreshIndexedHits(hits,{now});
 assert.equal(out.offers.length,2);
 assert.equal(out.rejectedStale,3);
 assert.equal(out.rejectedMalformed,2);
 assert.equal(out.rejectedExcluded,0);
 assert.deepEqual(out.offers.map(x=>x.sourceUrl),[hit(0).sourceUrl,hit(6).sourceUrl]);
 assert.ok(out.offers.every(x=>x.exactMatch===false&&x.matchConfidence===0&&x.dataKind==="indexed"));
 assert.equal(hits[0].exactMatch,true,"source objects are not mutated");
});
test("R04 P2: source diagnostic distinguishes raw hits from fresh eligible offers",()=>{
 const evidence=compactIndexRecallEvidence({
  configured:true,fetchedHits:420,offers:[hit(0),hit(1)],
  rejectedStale:417,rejectedExcluded:1,estimatedTotalHits:5700,
 },indexRecallPlan(1));
 assert.deepEqual(evidence,{
  configured:true,offset:80,limit:420,fetchedHits:420,acceptedFresh:2,
  rejectedStale:417,rejectedExcluded:1,rejectedMalformed:0,
  estimatedHits:5700,status:"observed",error:null,sourceObservationOnly:true,
 });
 const err=compactIndexRecallEvidence({configured:true,offers:[],
  error:"timeout"},indexRecallPlan(2));
 assert.equal(err.status,"failed");
 assert.equal(err.error,"index_recall_unavailable");
 assert.equal(err.estimatedHits,null);
 assert.equal(compactIndexRecallEvidence({configured:false,offers:[]},indexRecallPlan(1)).status,"unconfigured");
});
test("R04 P2: missing timestamps or untrusted historic price flags never acquire freshness",()=>{
 const hits=Array.from({length:500},(_,i)=>hit(i,{
   observedAt:i%2?null:new Date(now-120_000).toISOString(),
   exactMatch:true,matchConfidence:1,
 }));
 const result=filterFreshIndexedHits(hits,{now});
 assert.equal(result.offers.length,0);
 assert.equal(result.rejectedStale,500);
});
