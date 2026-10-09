// Attach a non-authorizing, evidence-backed coverage + repair report to
// the SAME GitHub Actions run that created real certification artifacts.
// No browser, merchant network call, database or token needed.
import {mkdir,writeFile,appendFile} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {configuredFreeStorefronts} from "../server/providers/free-storefronts.mjs";
import {loadSourceCertificationArtifacts} from "../server/tooling/source-certification-artifacts.mjs";
import {diagnoseActiveSourceCoverage} from "../server/tooling/source-coverage-diagnostic.mjs";
import {prioritizeCertificationFailures} from "../server/tooling/source-certification-triage.mjs";

const scrub=x=>String(x??"").replace(/[\r\n|<>]/g," ").slice(0,150);
export async function buildRealSourceCoverageReport({directory="source-cert-artifacts",
 activeIds=configuredFreeStorefronts().map(x=>x.id),now=new Date().toISOString(),
 runId=null,commitSha=null}={}){
 const {reports,issues,reportCount}=await loadSourceCertificationArtifacts(directory,activeIds);
 const coverage=diagnoseActiveSourceCoverage(activeIds,reports,
  {requiredActiveCount:39,observedAt:now});
 const triage=prioritizeCertificationFailures(coverage);
 const report={
  schemaVersion:1,evidenceType:"ci_certification_artifacts",
  runId:runId&&/^\d{1,20}$/.test(String(runId))?String(runId):null,
  commitSha:commitSha&&/^[a-f0-9]{40}$/.test(String(commitSha))?String(commitSha):null,
  reportCount,issues,coverage,triage
 };
 const lines=[
  "## NAWAA — Measured Source Coverage & Repair Priorities","",
  "**Configured:** "+coverage.configured+" · **Strictly certified:** "+coverage.strictlyCertified+
  " · **Failed:** "+coverage.failed+" · **Missing/corrupt:** "+coverage.missing,
  "",
  "**Important:** Source certification does not establish independent product-page price parity, image reachability, or Saudi checkout delivery.",
  "**Policy:** A configured or partially extractable source is not production-certified. No source activation is authorized.",
  "",
  "| Priority | Source | Status | Category | Positives | Action |",
  "|---|---|---|---|---:|---|",
  ...triage.items.map(r=>"| "+scrub(r.severity)+" | "+scrub(r.sourceId)+
   " | "+scrub(r.status)+" | "+scrub(r.category)+" | "+r.positiveQueriesPassed+
   "/2 | "+scrub(r.action)+" |"),
  "",
  issues.length?"**Artifact validation issues:** "+issues.length+" (see JSON for machine-readable details).":"",
  "**This report is observational and does not modify production source activation.**",""
 ];
 return {report,markdown:lines.join("\n")};
}
export async function writeRealSourceCoverageReport({directory="source-cert-artifacts",
 outputDirectory="source-cert-summary",now=new Date().toISOString(),
 runId=process.env.GITHUB_RUN_ID,commitSha=process.env.GITHUB_SHA,stepSummary=process.env.GITHUB_STEP_SUMMARY}={}){
 const {report,markdown}=await buildRealSourceCoverageReport({
  directory,now,runId,commitSha
 });
 await mkdir(outputDirectory,{recursive:true});
 await Promise.all([
  writeFile(resolve(outputDirectory,"active-source-coverage-diagnostic.json"),JSON.stringify(report,null,2)+"\n"),
  writeFile(resolve(outputDirectory,"active-source-repair-priorities.md"),markdown+"\n")
 ]);
 if(stepSummary)await appendFile(stepSummary,"\n"+markdown);
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 writeRealSourceCoverageReport().then(report=>{
  console.log(JSON.stringify({mode:report.coverage.mode,
   configured:report.coverage.configured,strictlyCertified:report.coverage.strictlyCertified,
   failed:report.coverage.failed,missing:report.coverage.missing,
   artifactValidationIssues:report.issues.length,priorityCounts:report.triage.priorityCounts},null,2));
 }).catch(error=>{console.error("source_diagnostic_generation_failed",error?.message);
  process.exitCode=1;});
}
