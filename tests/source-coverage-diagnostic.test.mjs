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
