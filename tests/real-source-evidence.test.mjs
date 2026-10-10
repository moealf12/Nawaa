import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {loadSourceCertificationArtifacts} from "../server/tooling/source-certification-artifacts.mjs";
import {buildRealSourceCoverageReport,writeRealSourceCoverageReport} from "../scripts/report-active-source-coverage.mjs";
import {prioritizeCertificationFailures} from "../server/tooling/source-certification-triage.mjs";

const ids=["ikea-sa","amazon-sa","noon-ae","lulu-sa"];
const NOW="2026-10-10T00:00:00.000Z";
const valid=(id)=>({
 source:id,observedAt:NOW,passed:true,routeCoverage:[{routed:true}],
 cases:[{query:"chair",pass:true,validCount:2},
  {query:"table",pass:true,validCount:1},
  {query:"nawaa-unfindable-x",pass:true,validCount:0}]
});
const failed=(id,error)=>({
 source:id,observedAt:NOW,passed:false,routeCoverage:[],
 cases:[{query:"chair",pass:false,validCount:0,error},
  {query:"table",pass:false,validCount:0},
  {query:"nawaa-unfindable-x",pass:true,validCount:0}]
});
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),"nawaa-source-evidence-"));
 const put=async(id,data)=>writeFile(join(dir,"active-source-"+id+".json"),
  typeof data==="string"?data:JSON.stringify(data));
 try{return await fn(dir,put)}finally{await rm(dir,{recursive:true,force:true})}
}
test("live-format raw artifacts drive measured coverage and safe repair queue",async()=>{
 await fixture(async(dir,put)=>{
  await put("ikea-sa",valid("ikea-sa"));
  await put("amazon-sa",failed("amazon-sa","HTTP 403"));
  await put("noon-ae",failed("noon-ae","timeout"));
  const {report,markdown}=await buildRealSourceCoverageReport({
   directory:dir,activeIds:ids,now:NOW,runId:"12345",commitSha:"a".repeat(40)});
  assert.equal(report.coverage.configured,4);
  assert.equal(report.coverage.strictlyCertified,1);
  assert.equal(report.coverage.failed,2);
  assert.equal(report.coverage.missing,1);
  assert.equal(report.reportCount,3);
  assert.equal(report.triage.totalFailedOrMissing,3);
  assert.equal(report.triage.priorityCounts.P0,2);
  assert.equal(report.triage.priorityCounts.P1,1);
  assert.equal(report.triage.items[0].category,"merchant_access_blocked");
  assert.equal(report.coverage.verifiedPriceParityByIndependentPageEvidence,0);
  assert.equal(report.triage.sourceActivationAllowed,false);
  assert.match(markdown,/Missing\/corrupt:\*\* 1/);
 });
});
test("wrong source identity, corrupt JSON, oversized reports never certify",async()=>{
 await fixture(async(dir,put)=>{
  await put("ikea-sa",{...valid("amazon-sa")});
  await put("amazon-sa","{broken-json");
  await put("noon-ae","x".repeat(1024*1024+1));
  const loaded=await loadSourceCertificationArtifacts(dir,ids);
  assert.equal(loaded.reportCount,0);
  assert.deepEqual(loaded.issues.map(x=>x.code).sort(),
   ["artifact_source_identity_mismatch","artifact_unreadable_or_corrupt","artifact_size_invalid"].sort());
  const {report}=await buildRealSourceCoverageReport({directory:dir,activeIds:ids,now:NOW});
  assert.equal(report.coverage.missing,4);
  assert.equal(report.coverage.strictlyCertified,0);
 });
});
test("unknown source files do not certify and missing directory yields missing",async()=>{
 await fixture(async(dir,put)=>{
  await put("unapproved-sa",valid("unapproved-sa"));
  const seen=await loadSourceCertificationArtifacts(dir,ids);
  assert.equal(seen.reportCount,0);
  assert.equal(seen.issues[0].code,"unexpected_source_artifact");
  const absent=await loadSourceCertificationArtifacts(join(dir,"missing"),ids);
  assert.equal(absent.reportCount,0);
 });
});
test("writer produces JSON, Markdown, and CI summary with no network",async()=>{
 await fixture(async(dir,put)=>{
  await put("ikea-sa",valid("ikea-sa"));
  const out=join(dir,"summary"),step=join(dir,"github-step-summary.md");
  await writeFile(step,"previous\n");
  // Writer uses actual registered source set (39) to avoid accidental undercount.
  const report=await writeRealSourceCoverageReport({
   directory:dir,outputDirectory:out,now:NOW,
   runId:"123",commitSha:"a".repeat(40),stepSummary:step});
  assert.equal(report.coverage.configured,39);
  assert.equal(report.coverage.strictlyCertified,1);
  assert.equal(report.coverage.missing,38);
  const json=JSON.parse(await readFile(join(out,"active-source-coverage-diagnostic.json"),"utf8"));
  assert.equal(json.coverage.strictlyCertified,1);
  assert.match(await readFile(join(out,"active-source-repair-priorities.md"),"utf8"),/Repair Priorities/);
  assert.match(await readFile(step,"utf8"),/Measured Source Coverage/);
 });
});
test("triage rejects invalid parameters and never authorizes activation",async()=>{
 assert.throws(()=>prioritizeCertificationFailures(null),/invalid_certification_diagnostic/);
 assert.throws(()=>prioritizeCertificationFailures({mode:"offline_certification_diagnostic",rows:[]},{maxItems:0}),/invalid_triage_limit/);
});
