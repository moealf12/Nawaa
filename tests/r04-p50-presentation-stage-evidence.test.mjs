import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {auditPresentationStages}
  from "../scripts/r04-p50-presentation-stage-evidence.mjs";
import {buildSearchPresentationSections}
  from "../src/search-result-presentation.mjs";

const group=(key,condition,title="laptop",match=true)=>{
  const offer={title,exactMatch:match,matchConfidence:match?.99:.2,
    productPrice:2500,currency:"SAR",merchant:"safe-test"};
  if(condition!==undefined)offer.condition=condition;
  return {key,offers:[offer],bestOffer:offer};
};
test("explicit condition, missing condition and actual mismatch remain separate",()=>{
  const g=[group("a","new"),group("b",undefined),group("c","used")];
  const sections=buildSearchPresentationSections("laptop",g);
  const out=auditPresentationStages("laptop",g,sections);
  assert.equal(out.classifierDirect,3);
  assert.equal(out.conditionMatched,1);
  assert.equal(out.conditionUnknown,1);
  assert.equal(out.conditionExplicitMismatch,1);
  assert.equal(out.finalPrincipal,1);
  assert.equal(out.unplacedDirect,2);
  assert.equal(out.unplacedUnknownCondition,1);
  assert.equal(out.unplacedExplicitMismatch,1);
  assert.equal(out.conditionUnknownMeans,"NOT_PROVEN_NEW");
  assert.equal(out.nextProbe,"VERIFY_SOURCE_CONDITION_PROVENANCE");
});
test("literal unknown, unrecognized labels and missing condition are NOT known used/new",()=>{
  const g=[group("literal","unknown"),group("unrecognized","renewed"),
    group("unset",undefined),group("clear","new")];
  const o=auditPresentationStages("laptop",g);
  assert.equal(o.classifierDirect,4);
  assert.equal(o.conditionUnknown,3);
  assert.equal(o.conditionUnrecognizedCodes,2);
  assert.equal(o.conditionExplicitMismatch,0);
  assert.equal(o.finalPrincipal,1);
  assert.equal(o.unplacedUnknownCondition,3);
  assert.equal(o.nextProbe,"VERIFY_SOURCE_CONDITION_PROVENANCE");
});
test("explicit used condition admits only matching used item, never guesses unknown",()=>{
  const g=[group("new","new"),group("used","used"),group("missing")];
  const out=auditPresentationStages("laptop used",g);
  assert.equal(out.requestedCondition,"explicit");
  assert.equal(out.conditionMatched,1);
  assert.equal(out.conditionExplicitMismatch,1);
  assert.equal(out.conditionUnknown,1);
  assert.equal(out.finalPrincipal,1);
});
test("zero strict classifier matches cannot be invented from related products",()=>{
  const g=[group("cover","new","laptop protective cover",false)];
  const out=auditPresentationStages("laptop",g);
  assert.equal(out.classifierDirect,0);
  assert.equal(out.finalPrincipal,0);
  assert.equal(out.unplacedDirect,0);
  assert.equal(out.nextProbe,"TRACE_LIVE_SOURCE_EXACT_MATCH_EVIDENCE");
});
test("valid direct exact group is not lost after discovery; conservation accounts",()=>{
  const g=[group("a","new")];
  const out=auditPresentationStages("laptop",g);
  assert.equal(out.finalPrincipal,1);
  assert.equal(out.initialDiscoveryPlaced+out.rescuedByExactTitleEvidence,1);
  assert.equal(out.conditionMatchedButUnplaced,0);
  assert.equal(out.input,out.finalPrincipal+out.finalRelated);
});
test("cannot trust inconsistent or duplicate presentation metadata",()=>{
  const g=[group("a","new")];
  const s=buildSearchPresentationSections("laptop",g);
  assert.throws(()=>auditPresentationStages("laptop",g,{
    ...s,exactGroups:[],partitionedGroups:1,
  }),/PRESENTATION_CONSERVATION_FAILED/);
  assert.throws(()=>auditPresentationStages("laptop",[g[0],g[0]]),
    /PRESENTATION_CONSERVATION_FAILED/);
  assert.throws(()=>auditPresentationStages("laptop",Array(1001).fill(g[0])),
    /INVALID_EVIDENCE_INPUT/);
});
test("only fixed counts and decisions: no query, title, SKU, seller, URL, price",()=>{
  const g=[group("private","new","laptop")];
  Object.assign(g[0].bestOffer,{
    sourceUrl:"https://hidden.example/path?token=SECRET",
    sku:"SECRET_SKU",merchant:"SECRET_SHOP",productPrice:999999,
  });
  const s=JSON.stringify(auditPresentationStages("customer@example.com laptop",g));
  for(const v of ["customer@example.com","hidden.example","SECRET",
    "999999","laptop"])assert.equal(s.includes(v),false,v);
});
test("real-live audit uses exact customer presentation result without mutation",()=>{
  const source=readFileSync(
    new URL("../scripts/r04-p36-candidate-36.mjs",import.meta.url),"utf8");
  assert.match(source,/auditPresentationStages\(q\.query,grouped,sections\)/);
  assert.match(source,/PRESENTATION_PARTITION_LOSS/);
  assert.match(source,/CLASSIFIER_AUDIT_PARITY_LOSS/);
});
