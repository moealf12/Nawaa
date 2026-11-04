import test from "node:test";
import assert from "node:assert/strict";
import {correlateLiveSearchTraces} from "../scripts/r04-p46-correlate-live-traces.mjs";
const a="a".repeat(16),b="b".repeat(16),c="c".repeat(16),d="d".repeat(16);
const rows=()=>[{id:"Q01",requestTraceId:a},{id:"Q02",requestTraceId:b},
  {id:"Q03",requestTraceId:c}];
const http=()=>[
  {requestId:a,totalHttpMs:10000,cacheLookupMs:9200,coalescedOnEntry:false,cacheMode:"miss",status:"finished"},
  {requestId:b,totalHttpMs:9300,cacheLookupMs:9000,coalescedOnEntry:true,cacheMode:"miss",status:"finished"},
  {requestId:c,totalHttpMs:3,cacheLookupMs:1,coalescedOnEntry:false,cacheMode:"fresh",status:"finished"},
];
const generation=()=>[
  {generationId:d,ownerRequestId:a,phaseAccounting:"CONSISTENT",
    dominantStages:["primary_acquisition"],lastBarrierCandidates:["provider-pass"],
    providerSpans:[{sourceId:"jarir-direct",pass:"primary",wallMs:5100,
      callbackQueueMs:1,completedFromSearchStartMs:5200,offers:8,errors:0}],
    phases:{primaryAcquisitionMs:9200,preSelectionMs:500,finalizationMs:200,pipelineMs:9900},
    stages:{selected:8,errorEvents:2},providerEventsDropped:0,deadlineExceeded:false},
];
test("joins a live refresh to its owner but never to a coalesced waiter",()=>{
  const o=correlateLiveSearchTraces({rows:rows(),httpSpans:http(),generations:generation()});
  assert.equal(o.association.GENERATION_OWNER_OBSERVED,1);
  assert.equal(o.association.COALESCED_REFRESH_NOT_OWNER,1);
  assert.equal(o.association.CACHE_HIT_NO_GENERATION,1);
  assert.equal(o.observations[0].generation.generationId,d);
  assert.equal(o.observations[1].generation,null);
  assert.equal(o.observations[2].generation,null);
  assert.equal(o.observations[0].generation.phases.primaryAcquisitionMs,9200);
  assert.equal(o.observations[0].generation.rootCause,"UNDETERMINED");
  assert.equal(o.measured.linkedGenerationCount,1);
  assert.equal(o.measured.phaseSample.primaryAcquisition.p95Ms,9200);
  assert.equal(o.measured.dominantStageCounts.primary_acquisition,1);
  assert.equal(o.measured.lastObservedBarrierCounts["provider-pass"],1);
  assert.equal(o.measured.slowProviderSamples[0].sourceId,"jarir-direct");
});
test("does not associate trace IDs without both a matching request and HTTP evidence",()=>{
  const x=http();x.shift();
  const o=correlateLiveSearchTraces({rows:rows(),httpSpans:x,generations:generation()});
  assert.equal(o.observations[0].linkage,"HTTP_EVENT_MISSING");
  assert.equal(o.observations[0].generation,null);
});
test("duplicate HTTP events and multiple generations remain explicitly ambiguous",()=>{
  const h=http();h.push({...h[0]});
  const g=generation();g.push({...g[0],generationId:"e".repeat(16)});
  const out=correlateLiveSearchTraces({rows:rows(),httpSpans:h,generations:g});
  assert.equal(out.observations[0].linkage,"HTTP_EVENT_AMBIGUOUS");
  const two=correlateLiveSearchTraces({rows:rows(),httpSpans:http(),generations:g});
  assert.equal(two.observations[0].linkage,"GENERATION_AMBIGUOUS");
});
test("malformed trace IDs, request IDs, duplicate intent identifiers fail closed",()=>{
  const x=rows();x[0].requestTraceId="bad";
  const o=correlateLiveSearchTraces({rows:x,httpSpans:http(),generations:generation()});
  assert.equal(o.observations[0].linkage,"REQUEST_ID_MISSING");
  x[0].id="Q02";
  assert.throws(()=>correlateLiveSearchTraces({rows:x,httpSpans:http()}),
    /INVALID_R04_P46_INTENT/);
});
test("query text, titles, prices, error strings and URLs are not forwarded",()=>{
  const h=http(),g=generation(),r=rows();
  h[0].query="customer@example.com";
  g[0].providerSpans[0].sourceId="https://blocked.example?token=secret";
  g[0].providerSpans[0].error="PRIVATE_KEY=secret";
  g[0].stages.someNewField="private";
  r[0].title="Private product 799 SAR";
  const s=JSON.stringify(correlateLiveSearchTraces({rows:r,httpSpans:h,generations:g}));
  for(const x of ["customer@example.com","blocked.example","PRIVATE_KEY",
    "someNewField","Private product","private"])assert.equal(s.includes(x),false);
});
test("truncation of raw events and unknown metrics never creates a made-up source",()=>{
  const g=generation();
  g[0].providerSpans=Array.from({length:60},(_,i)=>({
    sourceId:"p"+String(i).padStart(2,"0"),wallMs:2000,
  }));
  const out=correlateLiveSearchTraces({rows:rows(),httpSpans:http(),generations:g});
  assert.equal(out.observations[0].generation.providerSpans.length,24);
  assert.equal(out.observations[0].generation.providerSpans[0].offers,null);
});
