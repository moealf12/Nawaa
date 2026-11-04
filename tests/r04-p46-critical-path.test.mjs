import test from "node:test";
import assert from "node:assert/strict";
import {searchCriticalPathEvidence,newSearchDiagnosticId} from "../server/search-critical-path.mjs";
const hex=/^[0-9a-f]{16}$/;
function fixture(){
  return {
    generationId:"a".repeat(16),ownerRequestId:"b".repeat(16),
    primaryAcquiredMs:9600,preSelectionMs:1800,finalizationMs:400,totalMs:11800,
    providerTimings:[
      {sourceId:"jarir-direct",pass:"primary",providerWallMs:4100,queueMs:0,
        completedFromSearchStartMs:4200,offers:14,errors:0},
      {sourceId:"noon-ae",pass:"fallback",providerWallMs:7000,queueMs:300,
        completedFromSearchStartMs:9200,offers:0,errors:1},
    ],
    primaryComponents:[
      {component:"amazon-sa",settledAtMs:7500},
      {component:"provider-pass",settledAtMs:9600},
      {component:"meilisearch",settledAtMs:250},
      {component:"persisted",settledAtMs:1999,failed:true},
    ],
    offerStages:{providerRaw:14,amazonRaw:30,amazonValidated:9,indexRaw:0,
      catalogRaw:0,beforeCanonical:23,afterCanonical:23,
      rescoredAccepted:12,afterAdmission:21,selected:21,errorEvents:4},
    deadlineExceeded:false,fallbackUsed:true,
  };
}
test("generated request and generation IDs are bounded random hex",()=>{
  const x=Array.from({length:20},()=>newSearchDiagnosticId());
  assert.ok(x.every(v=>hex.test(v)));
  assert.equal(new Set(x).size,x.length);
});
test("critical stage reports observed ordering, not causal proof",()=>{
  const out=searchCriticalPathEvidence(fixture());
  assert.deepEqual(out.dominantStages,["primary_acquisition"]);
  assert.deepEqual(out.lastBarrierCandidates,["provider-pass"]);
  assert.equal(out.rootCause,"UNDETERMINED");
  assert.equal(out.phaseAccounting,"CONSISTENT");
  assert.equal(out.providerSpans[1].errors,1);
  assert.equal(out.providerSpans[1].callbackQueueMs,300);
  assert.equal(out.stages.afterAdmission,21);
  assert.equal(out.caveats.includes("barrier_last_settled_is_not_a_causal_root"),true);
});
test("parallel barriers tie remain ambiguous, no invented winner",()=>{
  const f=fixture();f.primaryComponents[0].settledAtMs=9599;
  const result=searchCriticalPathEvidence(f);
  assert.deepEqual(result.lastBarrierCandidates,["amazon-sa","provider-pass"]);
});
test("invalid or inconsistent timings fail closed on inferred dominance",()=>{
  const x=fixture();x.totalMs=7000;
  const out=searchCriticalPathEvidence(x);
  assert.equal(out.phaseAccounting,"UNKNOWN_OR_INCONSISTENT");
  assert.deepEqual(out.dominantStages,[]);
  const y=fixture();y.primaryAcquiredMs=-10;
  assert.equal(searchCriticalPathEvidence(y).phaseAccounting,"UNKNOWN_OR_INCONSISTENT");
});
test("provider cap and truncation are explicit and deterministic",()=>{
  const f=fixture();
  f.providerTimings=Array.from({length:56},(_,i)=>({
    sourceId:"store-"+i,pass:"primary",providerWallMs:i,offers:i,errors:0,
  }));
  f.providerEventsDropped=32;
  const out=searchCriticalPathEvidence(f);
  assert.equal(out.providerSpans.length,24);
  assert.equal(out.providerEventsDropped,32);
  assert.equal(out.providerSpans[23].sourceId,"unknown");
});
test("PII, arbitrary URLs, query text, raw errors and titles never appear in trace",()=>{
  const f=fixture();
  f.requestQuery="secret@example.com";
  f.providerTimings[0].sourceId="https://private.tld/?token=TOPSECRET";
  f.providerTimings[0].error="API_KEY=TOPSECRET";
  f.providerTimings[0].title="Private test product";
  f.primaryComponents.push({component:"http://private.tld",settledAtMs:10});
  f.offerStages.secret="something";
  const s=JSON.stringify(searchCriticalPathEvidence(f));
  for(const x of ["secret@example.com","private.tld","TOPSECRET","API_KEY",
    "Private test product","something"])assert.equal(s.includes(x),false);
  assert.equal(JSON.parse(s).providerSpans[0].sourceId,"unknown");
});
test("missing or invalid owner is not hallucinated",()=>{
  const x=fixture();x.ownerRequestId="not-an-id";
  assert.equal(searchCriticalPathEvidence(x).ownerRequestId,null);
  x.generationId="fake";
  assert.throws(()=>searchCriticalPathEvidence(x),/INVALID_SEARCH_TRACE_GENERATION/);
});
test("boundary: no providers, zero offers, incomplete bars stay unknown",()=>{
  const x=fixture();
  x.providerTimings=[];x.primaryComponents=[];x.offerStages={};
  const out=searchCriticalPathEvidence(x);
  assert.deepEqual(out.lastBarrierCandidates,[]);
  assert.equal(out.stages.selected,null);
  assert.equal(out.stages.errorEvents,null);
});
test("AsyncLocalStorage isolates two concurrent owner contexts and nested tasks",async()=>{
  const prior=process.env.NAWAA_SEARCH_DIAGNOSTIC_TRACE;
  process.env.NAWAA_SEARCH_DIAGNOSTIC_TRACE="1";
  const mod=await import("../server/search-critical-path.mjs?test-p46-enabled");
  if(prior===undefined)delete process.env.NAWAA_SEARCH_DIAGNOSTIC_TRACE;
  else process.env.NAWAA_SEARCH_DIAGNOSTIC_TRACE=prior;
  assert.equal(mod.SEARCH_TRACE_ENABLED,true);
  const a="a".repeat(16),b="b".repeat(16);
  const task=v=>mod.withSearchDiagnosticOwner(v,async()=>{
    await Promise.resolve();
    const child=await new Promise(resolve=>setImmediate(
      ()=>resolve(mod.currentSearchDiagnosticOwner())));
    return {owner:mod.currentSearchDiagnosticOwner(),child};
  });
  const [one,two]=await Promise.all([task(a),task(b)]);
  assert.deepEqual(one,{owner:a,child:a});
  assert.deepEqual(two,{owner:b,child:b});
  assert.equal(mod.currentSearchDiagnosticOwner(),null);
  await assert.rejects(async()=>mod.withSearchDiagnosticOwner("INVALID",async()=>0),
    /INVALID_SEARCH_TRACE_OWNER/);
});
