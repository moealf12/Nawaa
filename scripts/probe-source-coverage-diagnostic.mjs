// Offline fixture proof only: never presented as a real 39-source measurement.
import {diagnoseActiveSourceCoverage} from "../server/tooling/source-coverage-diagnostic.mjs";
const ids=["ikea-sa","amazon-sa","noon-ae","lulu-sa","virgin-ae"];
const reports=new Map([
 ["ikea-sa",{passed:true,routeCoverage:[{routed:true}],cases:[
  {query:"chair",pass:true,validCount:2},{query:"table",pass:true,validCount:2},
  {query:"nawaa-unfindable-test",pass:true,validCount:0}]}],
 ["amazon-sa",{passed:false,cases:[{query:"phone",pass:false,validCount:0,error:"HTTP 403"}]}],
 ["noon-ae",{passed:false,cases:[{query:"phone",pass:false,validCount:0,error:"timeout"}]}],
 ["lulu-sa",{passed:false,cases:[{query:"phone",pass:false,validCount:0,error:"HTTP 403"}]}]
]);
const result=diagnoseActiveSourceCoverage(ids,reports);
if(result.configured!==5||result.strictlyCertified!==1||
 result.failed!==3||result.missing!==1||result.reportCertifiesAll)
 throw new Error("source_diagnostic_fixture_failed");
console.log(JSON.stringify({fixtureOnly:true,notLiveSourceEvidence:true,...result},null,2));
