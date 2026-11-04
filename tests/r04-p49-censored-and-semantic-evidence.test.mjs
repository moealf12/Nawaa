import test from "node:test";
import assert from "node:assert/strict";
import {summarizePdpAttemptPhases,safePdpPhaseSummary}
  from "../server/pdp-phase-diagnostics.mjs";
import {safeStorefrontOutcome,summarizeMerchantForensics}
  from "../server/storefront-merchant-evidence.mjs";
import {summarizeGroupClassificationEvidence}
  from "../scripts/r04-p47-classification-evidence.mjs";

function pending({tls=200,total=6500,redirects=0,cancelled=true}={}){
  return {milestones:{
    dns_complete:10,request_started:20,socket_assigned:25,
    tcp_connected:70,tls_ready:tls,
  },redirects,clockInvalid:false,totalMs:total,outcome:"rejected",
  parentCancelled:cancelled,storeBudgetCancelled:cancelled,
  failureClass:"HTTP_TIMEOUT"};
}
test("TLS-to-termination censored wait is observed and NEVER a completed header P95",()=>{
  const out=summarizePdpAttemptPhases([pending()]);
  assert.equal(out.tlsReadyWithoutHeadersAtTermination,1);
  assert.equal(out.phaseMs.tlsReadyToCancellationLowerBound.observations,1);
  assert.equal(out.phaseMs.tlsReadyToCancellationLowerBound.p95,6300);
  assert.equal(out.phaseMs.headerWait.observations,0);
  assert.equal(out.phaseMs.headerWait.p95,null);
  assert.equal(out.storeBudgetCancelled,1);
  const safe=safePdpPhaseSummary(out);
  assert.equal(safe.phaseMs.tlsReadyToCancellationLowerBound.p95,6300);
  assert.equal(safe.tlsReadyWithoutHeadersAtTermination,1);
});
test("multi-hop, invalid clock, no TLS and successful headers yield no censored claim",()=>{
  const noTls=pending();delete noTls.milestones.tls_ready;
  const multiHop=pending({redirects:1});
  const badTime=pending({tls:9000});
  const successful={milestones:{...pending().milestones,headers_received:900,
    body_complete:1000},totalMs:1100,outcome:"succeeded",redirects:0};
  const out=summarizePdpAttemptPhases([noTls,multiHop,badTime,successful]);
  assert.equal(out.tlsReadyWithoutHeadersAtTermination,0);
  assert.equal(out.phaseMs.headerWait.p95,700);
  assert.equal(out.clockInconsistent,0);
});
test("source error class and censored latency aggregation are safely separated",()=>{
  const known=new Set(["bestbuy-us","noon-ae"]);
  const a=safeStorefrontOutcome({storeId:"bestbuy-us",pass:"primary",
    status:"rejected",failures:1,totalMs:6500,
    failureClass:"HTTP_TIMEOUT",
    pdpPhases:summarizePdpAttemptPhases([pending()]),
    rawError:"TOKEN_LEAK",sourceUrl:"https://unknown.invalid/?secret=VALUE",
  },{knownStoreIds:known});
  const b=safeStorefrontOutcome({storeId:"noon-ae",pass:"primary",
    status:"rejected",failures:1,totalMs:12,
    failureClass:"SOURCE_ACCESS_DENIED_COOLDOWN",
  },{knownStoreIds:known});
  const out=summarizeMerchantForensics([a,b]);
  const best=out.find(x=>x.storeId==="bestbuy-us");
  const noon=out.find(x=>x.storeId==="noon-ae");
  assert.equal(best.pdpSummary.tlsReadyWithoutHeadersAtTermination,1);
  assert.equal(best.pdpSummary.tlsReadyNoHeadersCensoredRunP95Ms,6300);
  assert.equal(noon.outcomeClasses.SOURCE_ACCESS_DENIED_COOLDOWN,1);
  assert.equal(noon.pdpSummary.attempts,0);
  const redacted=JSON.stringify(out);
  for(const value of ["TOKEN_LEAK","unknown.invalid","secret=VALUE"])
    assert.ok(!redacted.includes(value),value);
});
test("language/script divergence stays observation-only: no product promotion",()=>{
  const groups=[
    {bestOffer:{title:"عطر ديور رجالي",exactMatch:true,matchConfidence:.95}},
    {bestOffer:{title:"Dior Homme Perfume",exactMatch:false,matchConfidence:.5}},
    {bestOffer:{title:"عطر ديور رجالي بديل",exactMatch:false,matchConfidence:.5}},
  ];
  const d=summarizeGroupClassificationEvidence("عطر ديور رجالي",groups);
  assert.equal(d.alternativeScriptEvidence.queryScript,"arabic");
  assert.equal(d.alternativeScriptEvidence.latinTitles+
    d.alternativeScriptEvidence.arabicTitles+
    d.alternativeScriptEvidence.mixedTitles+
    d.alternativeScriptEvidence.unknownTitles,d.alternativeGroupsAudited);
  assert.equal(d.scriptEvidenceLevel,
    "CHARACTER_SCRIPT_MISMATCH_HYPOTHESIS_NOT_SEMANTIC_EQUIVALENCE");
  assert.ok(!JSON.stringify(d).includes("Dior Homme"));
  assert.equal(d.alternativeScriptEvidence.disjointScriptLowCoverage<=
    d.alternativeScriptEvidence.disjointScript,true);
});
