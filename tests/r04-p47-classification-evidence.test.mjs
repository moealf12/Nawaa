import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyResultGroup} from "../src/search-result-intelligence.mjs";
import {summarizeGroupClassificationEvidence}
  from "../scripts/r04-p47-classification-evidence.mjs";
const query="gaming desktop RTX 5070";
const offers=[
  {bestOffer:{title:"gaming desktop RTX 5070",exactMatch:true,matchConfidence:.98}},
  {bestOffer:{title:"RTX 5070 graphics card",exactMatch:false,matchConfidence:.4}},
  {bestOffer:{title:"unrelated listing",exactMatch:false,matchConfidence:.1}},
];
test("live classifier audit exactly matches actual decision histogram",()=>{
  const decisions=offers.map(g=>classifyResultGroup(query,g));
  const report=summarizeGroupClassificationEvidence(query,offers);
  assert.equal(report.examinedGroups,3);
  assert.equal(report.omittedGroups,0);
  assert.equal(report.invalidDecisions,0);
  assert.equal(Object.values(report.reasonCounts).reduce((a,b)=>a+b,0),3);
  for(const d of decisions){
    assert.ok(report.reasonCounts[d.reason]>=1);
    assert.ok(report.laneCounts[d.lane]>=1);
  }
  assert.equal(report.highMatchConfidence,1);
  assert.equal(report.sourceExact,1);
});
test("evidence report does not expose sensitive text, arbitrary URLs, prices or raw errors",()=>{
  const g=[{bestOffer:{title:"SECRET_CUSTOMER_TITLE",
    sourceUrl:"https://secret-merchant.test/p?token=secret",productPrice:12345,
    exactMatch:false,matchConfidence:0.1}}];
  const json=JSON.stringify(summarizeGroupClassificationEvidence(
    "customer@example.com",g));
  for(const v of ["SECRET_CUSTOMER_TITLE","secret-merchant","12345",
    "customer@example.com","token=secret"])
    assert.equal(json.includes(v),false,v);
});
test("input bounds make missing and truncated evidence explicit",()=>{
  assert.throws(()=>summarizeGroupClassificationEvidence(query,{}),/INVALID_CLASSIFIER/);
  assert.throws(()=>summarizeGroupClassificationEvidence(query,[],{maxGroups:5000}),
    /INVALID_CLASSIFIER_EVIDENCE_LIMIT/);
  const r=summarizeGroupClassificationEvidence(query,[...offers,...offers],{maxGroups:3});
  assert.equal(r.examinedGroups,3);
  assert.equal(r.omittedGroups,3);
});
test("missing offers are classified unknown, not merchant stockout",()=>{
  const r=summarizeGroupClassificationEvidence(query,[{},null]);
  assert.equal(r.reasonCounts.missing_offer,2);
  assert.ok(!JSON.stringify(r).includes("out_of_stock"));
});
test("corpus candidate tests the classifier without replacing customer behavior",()=>{
  const source=readFileSync(new URL("../scripts/r04-p36-candidate-36.mjs",import.meta.url),"utf8");
  assert.match(source,/CLASSIFIER_AUDIT_PARITY_LOSS/);
  assert.match(source,/buildSearchPresentationSections\(q\.query,grouped\)/);
  assert.match(source,/summarizeGroupClassificationEvidence\(q\.query,grouped\)/);
});
