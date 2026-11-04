import test from "node:test";
import assert from "node:assert/strict";
import {diagnoseR04Evidence} from "../scripts/r04-causal-diagnostics.mjs";

const SHA="acbab8447a7129ca15da9bdbd7a8c94dbfe967f0";
function liveReport(){
  return {
    schemaVersion:"nawaa.r04.36-live-corpus.v1",
    expectedSha:SHA,
    healthBefore:{ok:true,revision:SHA},
    healthAfter:{ok:true,revision:SHA},
    rows:Array.from({length:36},(_,i)=>({
      id:"Q"+String(i+1).padStart(2,"0"),
      status:"OBSERVED",offers:10,primaryGroups:5,relatedGroups:5,
      elapsedMs:1000,partial:false,deadlineExceeded:false,sourceErrors:0,
      catalogRecallStatus:"observed",
      sourceErrorBreakdown:{reported:0,otherEvents:0,buckets:[]},
    })),
    summary:{sourceErrorEvents:0},
  };
}
function signal(row,code){return row.signals.some(x=>x.code===code);}
test("all verified live observations: no invented failure hypotheses",()=>{
  const x=diagnoseR04Evidence(liveReport());
  assert.equal(x.provenance.observed,36);
  assert.equal(x.sample.missingPrincipal,0);
  assert.equal(x.investigations.length,0);
  assert.equal(x.sample.sampleP95Ms,1000);
  assert.equal(x.sample.sourceErrorReconciliation,"MATCH");
});
test("source block evidence and missing principal are separately attributed",()=>{
  const r=liveReport(),a=r.rows[0];
  Object.assign(a,{offers:12,primaryGroups:0,relatedGroups:12,partial:true,
    sourceErrors:3,sourceErrorBreakdown:{reported:3,otherEvents:1,buckets:[
      {sourceId:"temu-global",failureClass:"HTTP_200_BLOCK_PAGE",count:2},
    ]}});
  r.summary.sourceErrorEvents=3;
  const x=diagnoseR04Evidence(r);
  assert.ok(signal(x.rows[0],"PRINCIPAL_PRESENTATION_GAP"));
  assert.ok(signal(x.rows[0],"SOURCE_ACCESS_BLOCK"));
  assert.equal(x.sample.sourceErrorEventsOutsideTop32,1);
  assert.equal(x.sample.missingPrincipal,1);
  assert.equal(x.sample.sourceErrorReconciliation,"MATCH");
  assert.equal(x.classification,"OBSERVATIONAL_TRIAGE_NOT_CAUSAL_PROOF");
});
test("unknown classifications remain visible without leaking raw source errors",()=>{
  const r=liveReport();
  r.rows[0].sourceErrors=3;
  r.rows[0].sourceErrorBreakdown={reported:3,otherEvents:1,buckets:[
    {sourceId:"virgin-ae",failureClass:"UNCLASSIFIED",count:2},
  ]};
  r.summary.sourceErrorEvents=3;
  const x=diagnoseR04Evidence(r);
  assert.ok(signal(x.rows[0],"SOURCE_CLASSIFICATION_GAP"));
  assert.equal(x.sample.sourceUnclassifiedEventsAtLeast,2);
  assert.equal(x.sample.sourceErrorEventsOutsideTop32,1);
});
test("no verified offers is not false inventory absence",()=>{
  const r=liveReport();
  Object.assign(r.rows[2],{offers:0,primaryGroups:0,relatedGroups:0});
  assert.ok(signal(diagnoseR04Evidence(r).rows[2],"NO_VERIFIED_OFFERS"));
  assert.ok(!JSON.stringify(diagnoseR04Evidence(r)).includes("OUT_OF_STOCK"));
});
test("deadlines remain separate from HTTP request failures",()=>{
  const r=liveReport();
  r.rows[3].deadlineExceeded=true;
  Object.assign(r.rows[4],{status:"REQUEST_FAILED",failurePhase:"headers",
    elapsedMs:30000});
  const x=diagnoseR04Evidence(r);
  assert.equal(x.sample.internalDeadlines,1);
  assert.equal(x.provenance.requestFailed,1);
  assert.ok(signal(x.rows[3],"INTERNAL_DEADLINE"));
  assert.ok(signal(x.rows[4],"REQUEST_TRANSPORT_FAILURE"));
});
test("parse failures are not mislabeled network blocks",()=>{
  const r=liveReport();
  Object.assign(r.rows[0],{status:"REQUEST_FAILED",failurePhase:"parse"});
  const x=diagnoseR04Evidence(r);
  assert.ok(signal(x.rows[0],"RESPONSE_PARSE_FAILURE"));
  assert.ok(!signal(x.rows[0],"SOURCE_ACCESS_BLOCK"));
});
test("source error event conservation failures are explicit",()=>{
  const r=liveReport();
  r.rows[0].sourceErrors=2;
  r.rows[0].sourceErrorBreakdown={reported:2,otherEvents:0,buckets:[
    {sourceId:"noon-sa",failureClass:"HTTP_TIMEOUT",count:1},
  ]};
  r.summary.sourceErrorEvents=2;
  const x=diagnoseR04Evidence(r);
  assert.ok(signal(x.rows[0],"SOURCE_ERROR_ACCOUNTING_GAP"));
});
test("observed header/body/parse hotspots remain observational, not causal",()=>{
  const r=liveReport();
  Object.assign(r.rows[0],{elapsedMs:10000,responseBytes:2500000,
    responsePhasesMs:{headers:9000,body:800,parse:200}});
  Object.assign(r.rows[1],{elapsedMs:10000,
    responsePhasesMs:{headers:3000,body:6500,parse:500}});
  Object.assign(r.rows[2],{elapsedMs:5000,
    responsePhasesMs:{headers:3000,body:500,parse:1500}});
  const x=diagnoseR04Evidence(r);
  assert.ok(signal(x.rows[0],"CLIENT_HEADER_WAIT_DOMINANT"));
  assert.ok(signal(x.rows[1],"CLIENT_BODY_READ_DOMINANT"));
  assert.ok(signal(x.rows[2],"CLIENT_PARSE_COST_DOMINANT"));
  assert.equal(x.sample.responseBytesP95,2500000);
  assert.equal(x.classification,"OBSERVATIONAL_TRIAGE_NOT_CAUSAL_PROOF");
});
test("missing contract evidence remains unknown, never silently false",()=>{
  const r=liveReport();
  Object.assign(r.rows[0],{deadlineExceeded:null,sourceErrors:null,
    catalogRecallStatus:null});
  const x=diagnoseR04Evidence(r);
  assert.ok(signal(x.rows[0],"DEADLINE_EVIDENCE_MISSING"));
  assert.ok(signal(x.rows[0],"SOURCE_ERROR_EVIDENCE_MISSING"));
  assert.ok(signal(x.rows[0],"CATALOG_EVIDENCE_MISSING"));
});
test("absent and contradictory source coverage never passes silently",()=>{
  const r=liveReport();
  r.rows[0].partial=null;
  r.rows[1].partial=false;
  r.rows[1].sourceErrors=3;
  r.rows[1].sourceErrorBreakdown={reported:3,otherEvents:3,buckets:[]};
  r.summary.sourceErrorEvents=3;
  const x=diagnoseR04Evidence(r);
  assert.ok(signal(x.rows[0],"COVERAGE_EVIDENCE_MISSING"));
  assert.ok(signal(x.rows[1],"COVERAGE_CONTRADICTION"));
});
test("end-to-end phase sums never permit impossible timing claims",()=>{
  const r=liveReport();
  r.rows[0].responsePhasesMs={headers:900,body:900,parse:900};
  assert.ok(signal(diagnoseR04Evidence(r).rows[0],"INCONSISTENT_TIMING_EVIDENCE"));
});
test("credential, arbitrary query, URLs and raw upstream messages never enter output",()=>{
  const r=liveReport();
  Object.assign(r.rows[0],{
    query:"secret@example.com",
    firstTen:[{title:"SECRET_PRICE_999",sourceHost:"secret.host"}],
    sourceErrorBreakdown:{reported:1,otherEvents:0,buckets:[
      {sourceId:"https://bad.host/?key=SECRET",failureClass:"HTTP_TIMEOUT",count:1},
    ]},
    sourceErrors:1,
  });
  r.summary.sourceErrorEvents=1;
  const text=JSON.stringify(diagnoseR04Evidence(r));
  for(const value of ["secret@example.com","SECRET_PRICE_999","secret.host","bad.host","SECRET"])
    assert.ok(!text.includes(value),value);
});
test("wrong, unverified or stale production SHA fails closed",()=>{
  const r=liveReport();
  r.healthAfter.revision="f".repeat(40);
  assert.throws(()=>diagnoseR04Evidence(r),/DIAGNOSTIC_PROVENANCE_NOT_VERIFIED/);
  r.healthAfter.revision=SHA;
  r.expectedSha="main";
  assert.throws(()=>diagnoseR04Evidence(r),/DIAGNOSTIC_SHA_INVALID/);
});
test("duplicated intents and incomplete corpus cannot produce false green",()=>{
  const r=liveReport();
  r.rows[8].id="Q01";
  assert.throws(()=>diagnoseR04Evidence(r),/DIAGNOSTIC_INTENT_ID_INVALID/);
  r.rows.pop();
  assert.throws(()=>diagnoseR04Evidence(r),/DIAGNOSTIC_CORPUS_SHAPE_INVALID/);
});
test("unknown request evidence remains unknown rather than absent inventory",()=>{
  const r=liveReport();
  Object.assign(r.rows[10],{status:"NOT_RUN",offers:0});
  const x=diagnoseR04Evidence(r);
  assert.equal(x.provenance.evidenceMissing,1);
  assert.equal(x.sample.missingPrincipal,0);
  assert.ok(signal(x.rows[10],"REQUEST_EVIDENCE_MISSING"));
});
