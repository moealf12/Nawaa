import test from "node:test";
import assert from "node:assert/strict";
import {
  loadOracleHandshake,validateOracleHandshake,eventDigest,
} from "../scripts/verify-oracle-handshake.mjs";

const original=loadOracleHandshake();
const clone=()=>structuredClone(original);
const errors=(x,opts={})=>validateOracleHandshake(
  x.manifest,x.events,{currentMainSha:x.manifest.baseMainSha,...opts});
function reseal(events){
  let previous=null;
  for(const e of events){
    e.prevHash=previous;
    e.eventHash=eventDigest(e);
    previous=e.eventHash;
  }
}
test("recorded Oracle handshake validates with exact current main",()=>{
  assert.deepEqual(errors(clone()),[]);
  assert.ok(original.events.length>=3);
  assert.equal(original.events[0].type,"INTENT_REGISTERED");
  assert.equal(original.events[1].type,"BASELINE_ATTESTED");
  const probe=original.events.find(event=>event.type==="LIVE_PROBE_RECORDED");
  assert.ok(probe,"real Oracle attempt must remain recorded");
  assert.equal(probe.details.sourceTaskStatus,"blocked");
  assert.equal(probe.details.candidateCount,0);
});
test("missing external main proof fails closed",()=>{
  const x=clone();
  assert.ok(validateOracleHandshake(x.manifest,x.events)
    .some(s=>s.includes("fresh external head SHA required")));
});
test("stale main SHA is rejected",()=>{
  assert.ok(errors(clone(),{currentMainSha:"f".repeat(40)})
    .some(s=>s.includes("mainSHA")));
});
test("event hash detects modified source observation",()=>{
  const x=clone();x.events[2].details.candidateCount=1000;
  assert.ok(errors(x).some(s=>s.includes("eventHash")));
});
test("re-ordered steps are rejected",()=>{
  const x=clone();[x.events[1],x.events[2]]=[x.events[2],x.events[1]];
  assert.ok(errors(x).some(s=>s.includes("invalid transition")));
});
test("missing baseline or step fails",()=>{
  const x=clone();x.events.splice(1,1);reseal(x.events);
  assert.ok(errors(x).some(s=>s.includes("transition")));
});
test("duplicate sequence number is rejected",()=>{
  const x=clone();x.events[1].seq=1;reseal(x.events);
  assert.ok(errors(x).some(s=>s.includes("not monotonic")));
});
test("missing durable Gateway job cannot be declared an observation",()=>{
  const x=clone();x.events[2].details.gatewayJobId=null;reseal(x.events);
  assert.ok(errors(x).some(s=>s.includes("missing durable Gateway job")));
});
test("robots timeout may not silently continue to search",()=>{
  const x=clone();x.events[2].details.searchHttp=200;reseal(x.events);
  assert.ok(errors(x).some(s=>s.includes("fail-closed robots")));
});
test("invented PDP/checkout verification is rejected",()=>{
  const x=clone();x.events[2].details.pdpVerified=true;reseal(x.events);
  assert.ok(errors(x).some(s=>s.includes("unverified parity claim")));
});
test("scope or pricing permissions cannot be broadened",()=>{
  const x=clone();x.manifest.noMainWrites=false;x.manifest.noPaidResources=false;
  assert.ok(errors(x).some(s=>s.includes("noMainWrites")));
  assert.ok(errors(x).some(s=>s.includes("noPaidResources")));
});
test("retries, proxy and request budgets are immutable",()=>{
  const x=clone();x.manifest.liveProbePolicy.retries=3;
  x.manifest.liveProbePolicy.proxy=true;
  assert.ok(errors(x).some(s=>s.includes("liveProbePolicy")));
});
test("the ledger cannot be promoted by claiming an unsupported outcome",()=>{
  const x=clone();x.events[2].details.outcome="PDP_VERIFIED";reseal(x.events);
  assert.ok(errors(x).some(s=>s.includes("source/provenance invalid")));
});
test("an unauthorized task/branch receipt is rejected even with a valid digest",()=>{
  const x=clone();x.events[2].branch="main";reseal(x.events);
  assert.ok(errors(x).some(s=>s.includes("identity mismatch")));
});
