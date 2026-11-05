// R04 postmerge read-only release gate on the *actual published Render API*.
// Evaluates an independently collected 36-intent round. Do not equate this
// structural shopper-acceptance gate with independently graded product truth.
import {readFileSync,writeFileSync} from "node:fs";

const expected=process.env.NAWAA_EXPECT_LIVE_SHA||"";
const round=Number(process.env.NAWAA_R04_ROUND||"");
const validSha=/^[0-9a-f]{40}$/.test(expected);
const reasons=[];
const failures=[];
let evidence=null;
try{
  evidence=JSON.parse(readFileSync("r04-36-live-corpus-evidence.json","utf8"));
}catch{
  reasons.push("LIVE_EVIDENCE_MISSING_OR_INVALID");
}
if(!validSha)reasons.push("EXPECTED_SHA_INVALID");
if(![1,2].includes(round))reasons.push("ROUND_NUMBER_INVALID");
const expectedIds=Array.from({length:36},(_,i)=>"Q"+String(i+1).padStart(2,"0"));
let observed=0,strict=0,offers=0,sourceErrors=0,partial=0,unadjudicated=0;
if(evidence){
  if(evidence.schemaVersion!=="nawaa.r04.36-live-corpus.v1")
    reasons.push("INVALID_EVIDENCE_SCHEMA");
  if(evidence.mode!=="READ_ONLY_PUBLIC_EXACT_SHA")
    reasons.push("INVALID_EVIDENCE_PROVENANCE");
  if(evidence.expectedSha!==expected)reasons.push("COLLECTOR_EXPECTED_SHA_MISMATCH");
  if(evidence.fatal!==null)reasons.push("LIVE_COLLECTION_FATAL");
  for(const phase of ["healthBefore","healthAfter"]){
    const h=evidence[phase];
    if(h?.http!==200||h?.ok!==true||h?.revision!==expected)
      reasons.push(phase.toUpperCase()+"_EXACT_REVISION_MISMATCH");
  }
  if(!Array.isArray(evidence.rows)||evidence.rows.length!==36)
    reasons.push("FROZEN_CORPUS_LENGTH_MISMATCH");
  else{
    const ids=evidence.rows.map(r=>r?.id);
    if(expectedIds.some((id,i)=>ids[i]!==id))
      reasons.push("FROZEN_CORPUS_ID_ORDER_MISMATCH");
    for(let i=0;i<36;i++){
      const row=evidence.rows[i];
      const why=[];
      if(row?.status!=="OBSERVED")why.push("REQUEST_NOT_OBSERVED");
      else observed++;
      if(!Number.isSafeInteger(row?.offers)||row.offers<0)
        why.push("OFFERS_MISSING_OR_INVALID");
      else offers+=row.offers;
      if(!Number.isSafeInteger(row?.primaryGroups)||row.primaryGroups<1)
        why.push("MISSING_STRICT_PRINCIPAL_GROUPS");
      else strict++;
      if(!Number.isSafeInteger(row?.groupCount)||row.groupCount<0||
         !Number.isSafeInteger(row?.presentedGroups)||
         row.presentedGroups!==row.groupCount)
        why.push("GROUP_PARTITION_LOSS_OR_UNKNOWN");
      if(row?.deadlineExceeded===true)
        why.push("INTERNAL_DEADLINE_EXCEEDED");
      if(!Number.isSafeInteger(row?.sourceErrors)||row.sourceErrors<0)
        why.push("SOURCE_FAILURE_EVIDENCE_UNAVAILABLE");
      else sourceErrors+=row.sourceErrors;
      if(row?.partial===true)partial++;
      if(Number.isSafeInteger(row?.judgments?.unjudged))
        unadjudicated+=row.judgments.unjudged;
      if(why.length)failures.push({id:expectedIds[i],reasonCodes:why});
    }
  }
  if(evidence.summary?.result!=="EVIDENCE_COLLECTED"||
     evidence.summary?.corpusFrozen!==true||
     evidence.summary?.partitionedWithoutLoss!==true)
    reasons.push("ORIGINAL_CORPUS_COLLECTOR_GATE_NOT_PASS");
}
const verdict=reasons.length===0&&failures.length===0?"STRUCTURAL_ACCEPTANCE_PASS":"NO_GO";
const report={
  schemaVersion:"nawaa.r04.p52.postmerge-readonly-gate.v1",
  exactExpectedRenderSha:validSha?expected:null,
  round:[1,2].includes(round)?round:null,
  verdict,observedQueries:observed,queriesWithStrictPrincipals:strict,
  offeredResults:offers,partialCoverageQueries:partial,sourceErrorEvents:sourceErrors,
  unadjudicatedFirstScreenLabels:unadjudicated,
  reasons,failures,
  independentProductJudgmentCertified:false,
  exhaustiveMerchantCoverageCertified:false,
  sseJsonParityCertified:false,
  productionP95Certified:false,
  note:"Read-only actual Render. A PASS is structural 36-intent acceptance, not R04 final closure.",
};
const path="r04-postmerge-round-"+([1,2].includes(round)?round:"invalid")+"-gate.json";
writeFileSync(path,JSON.stringify(report,null,2)+"\n");
console.log("NAWAA_R04_POSTMERGE_ACCEPTANCE "+JSON.stringify(report));
if(verdict!=="STRUCTURAL_ACCEPTANCE_PASS")process.exitCode=1;
