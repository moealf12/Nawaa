import test from "node:test";
import assert from "node:assert/strict";
import {diagnoseActiveSourceCoverage} from "../server/tooling/source-coverage-diagnostic.mjs";
const certified=id=>({source:id,passed:true,routeCoverage:[{routed:true}],
 cases:[{query:"laptop",pass:true,validCount:2},{query:"phone",pass:true,validCount:1},
 {query:"nawaa-unfindable-x",pass:true,validCount:0}]});
const failed=(id,error,validCount=0)=>({source:id,passed:false,routeCoverage:[],
 cases:[{query:"laptop",pass:false,error,validCount},{query:"phone",pass:false,validCount:0},
 {query:"nawaa-unfindable-x",pass:true,validCount:0}]});
test("distinguishes configured, extraction and strict certification",()=>{
 const reports=new Map([["ikea-sa",certified("ikea-sa")],
 ["amazon-sa",failed("amazon-sa","HTTP 403")],
 ["noon-ae",failed("noon-ae","Operation aborted due to timeout")],
 ["virgin-ae",failed("virgin-ae","CANDIDATES_WITHOUT_VALID_OFFERS",1)]]);
 const r=diagnoseActiveSourceCoverage(["ikea-sa","amazon-sa","noon-ae","virgin-ae","other"],reports);
 assert.equal(r.configured,5);assert.equal(r.strictlyCertified,1);
 assert.equal(r.failed,3);assert.equal(r.missing,1);
 assert.equal(r.reportCertifiesAll,false);
 assert.equal(r.verifiedPriceParityByIndependentPageEvidence,0);
 assert.equal(r.rows[0].independentPriceParity,"not_verified_by_this_report");
 assert.equal(r.rows[1].diagnosis,"merchant_access_blocked");
 assert.equal(r.rows[2].diagnosis,"transport_or_timeout");
 assert.equal(r.rows[3].extractionEvidence,"positive_candidates");
 assert.equal(r.rows[3].evidenceStatus,"failed");
 assert.equal(r.rows[4].diagnosis,"missing_evidence");
});
test("missing artifacts never inherit certification from configuration",()=>{
 const r=diagnoseActiveSourceCoverage(["a"],new Map());
 assert.equal(r.rows[0].evidenceStatus,"not_tested");
 assert.equal(r.rows[0].extractionEvidence,"not_proven");
});
test("negative probe or missing route prevents certification",()=>{
 const bad=certified("a");bad.cases[2].pass=false;
 const r=diagnoseActiveSourceCoverage(["a"],new Map([["a",bad]]),{requiredActiveCount:1});
 assert.equal(r.strictlyCertified,0);
 assert.equal(r.rows[0].evidenceStatus,"failed");
});
test("does not allow shrinking 39 sources to falsely declare success",()=>{
 const r=diagnoseActiveSourceCoverage(["a"],new Map([["a",certified("a")]]));
 assert.equal(r.strictlyCertified,1);assert.equal(r.reportCertifiesAll,false);
});
test("rejects malformed IDs, duplicate sources and invalid time",()=>{
 assert.throws(()=>diagnoseActiveSourceCoverage(["a","a"],new Map()),/invalid_source_diagnostic_input/);
 assert.throws(()=>diagnoseActiveSourceCoverage(["bad/source"],new Map()),/invalid_source_diagnostic_input/);
 assert.throws(()=>diagnoseActiveSourceCoverage(["a"],new Map(),{observedAt:"yesterday"}),/invalid_source_diagnostic_timestamp/);
});

test("classifies HTTP 503 and oversized responses separately rather than treating them as unknown",()=>{
 const reports=new Map([
  ["amazon-ae",failed("amazon-ae","HTTP 503",1)],
  ["jumbo-ae",failed("jumbo-ae","jumbo-category: search response too large")]
 ]);
 const result=diagnoseActiveSourceCoverage(["amazon-ae","jumbo-ae"],reports);
 assert.equal(result.rows[0].diagnosis,"transient_merchant_http_error");
 assert.equal(result.rows[1].diagnosis,"oversized_merchant_response");
 assert.equal(result.sourceActivationChangesPerformed,0);
});

test("Virgin AirPods positive check cannot hide two actual EarPods wired examples",()=>{
 const virgin={
  source:"virgin-ae",passed:false,routeCoverage:[{query:"airpods",routed:true}],
  cases:[
   {query:"airpods",pass:true,validCount:2,examples:[
    {title:"Apple EarPods Wired In-Ear Headphones (Lightning)",price:2.04},
    {title:"Apple EarPods Wired In-Ear Headphones (3.5mm Jack)",price:2.04}]},
   {query:"playstation 5",pass:false,validCount:0,error:"CANDIDATES_WITHOUT_VALID_OFFERS",examples:[]},
   {query:"nawaa-unfindable-943271-20261003",pass:true,validCount:0}
  ]
 };
 const result=diagnoseActiveSourceCoverage(["virgin-ae"],new Map([["virgin-ae",virgin]]));
 const row=result.rows[0];
 assert.equal(result.modelMismatchSources,1);
 assert.deepEqual(row.modelMismatchQueries,["airpods"]);
 assert.equal(row.modelExampleEvidence[0].status,"exhaustive_sample_model_mismatch");
 assert.equal(row.modelExampleEvidence[0].coverage,"all_valid_offers");
 assert.equal(row.evidenceStatus,"failed");
 assert.equal(result.reportCertifiesAll,false);
});
test("sampled mismatches cannot condemn unseen valid results",()=>{
 const report={source:"amazon-ae",passed:false,routeCoverage:[],cases:[
  {query:"airpods",pass:true,validCount:36,examples:[
    {title:"Generic bluetooth earbud A"},{title:"Generic bluetooth earbud B"}]},
  {query:"iphone 17",pass:false,validCount:0},
  {query:"nawaa-unfindable-943271-20261003",pass:true,validCount:0}
 ]};
 const result=diagnoseActiveSourceCoverage(["amazon-ae"],new Map([["amazon-ae",report]]));
 assert.equal(result.modelMismatchSources,0);
 assert.equal(result.incompleteModelEvidenceSources,1);
 assert.equal(result.rows[0].modelExampleEvidence[0].status,"partial_sample_without_model_match");
});
test("recognizes actual model tokens without confusing AirPods and EarPods",()=>{
 const report={source:"test-model",passed:true,routeCoverage:[{routed:true}],cases:[
  {query:"playstation 5",pass:true,validCount:1,examples:[{title:"Sony PlayStation PS5 Slim Console"}]},
  {query:"galaxy s25",pass:true,validCount:1,examples:[{title:"Samsung Galaxy S25 Ultra"}]},
  {query:"nawaa-unfindable-943271-20261003",pass:true,validCount:0}
 ]};
 const r=diagnoseActiveSourceCoverage(["test-model"],new Map([["test-model",report]]),{requiredActiveCount:1});
 assert.equal(r.strictlyCertified,1);
 assert.equal(r.modelMismatchSources,0);
 assert.equal(r.rows[0].modelExampleEvidence.every(x=>x.status==="model_token_found_in_sample"),true);
});

test("model mismatch is a separate repair reason and cannot pass by structural offer count",()=>{
 const report=failed("virgin-ae","QUERY_MODEL_MISMATCH",2);
 const result=diagnoseActiveSourceCoverage(["virgin-ae"],new Map([["virgin-ae",report]]));
 assert.equal(result.rows[0].diagnosis,"query_model_mismatch");
 assert.equal(result.rows[0].evidenceStatus,"failed");
});
