import {readdir,readFile,mkdir,writeFile,appendFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {configuredFreeStorefronts} from "../server/providers/free-storefronts.mjs";

export function summarizeCertification(activeIds,reports,expectedActiveCount=activeIds.length) {
  const rows=activeIds.map(id=>{
    const report=reports.get(id);
    if(!report) return {id,status:"MISSING",positiveChecks:0,reason:"No certification artifact"};
    const positives=(report.cases||[]).filter(c=>!String(c.query||"").startsWith("nawaa-unfindable-"));
    const negatives=(report.cases||[]).filter(c=>String(c.query||"").startsWith("nawaa-unfindable-"));
    const routeOk=Array.isArray(report.routeCoverage)&&report.routeCoverage.some(r=>r.routed===true);
    const passed=report.passed===true&&positives.length===2&&positives.every(c=>c.pass===true&&c.validCount>0)
      &&negatives.length===1&&negatives[0].pass===true&&routeOk;
    const bad=(report.cases||[]).find(c=>c.pass!==true);
    const reason=passed?"":String(bad?.error||bad?.failureKind||(!routeOk?"UNROUTED": "INCOMPLETE_EVIDENCE")).slice(0,180);
    return {id,status:passed?"CERTIFIED":"FAILED",positiveChecks:positives.filter(c=>c.pass===true).length,reason};
  });
  const stats={
    expected:rows.length,
    certified:rows.filter(r=>r.status==="CERTIFIED").length,
    failed:rows.filter(r=>r.status==="FAILED").length,
    missing:rows.filter(r=>r.status==="MISSING").length,
  };
  return {requiredActiveCount:expectedActiveCount,stats,rows,passed:stats.certified===stats.expected&&stats.expected===expectedActiveCount&&expectedActiveCount>0};
}

async function main(){
  const folder=resolve(process.env.SOURCE_CERT_DIR||"source-cert-artifacts");
  const paths=(await readdir(folder).catch(error=>{if(error?.code==="ENOENT")return [];throw error;}))
    .filter(file=>/^active-source-[a-z0-9-]+\.json$/.test(file));
  const reports=new Map();
  for(const file of paths){
    try {
      const report=JSON.parse(await readFile(join(folder,file),"utf8"));
      if(typeof report?.source!=="string"||reports.has(report.source))continue;
      reports.set(report.source,report);
    } catch(error) {console.warn("invalid source artifact",file,error?.message||String(error));}
  }
  const activeIds=configuredFreeStorefronts().map(s=>s.id);
  const result=summarizeCertification(activeIds,reports,39);
  await mkdir("source-cert-summary",{recursive:true});
  await writeFile("source-cert-summary/active-source-certification-summary.json",JSON.stringify(result,null,2)+"\n");
  const scrub=value=>String(value||"").replace(/[|\n\r]/g," ").slice(0,180);
  const markdown=[
    "## NAWAA Architecture v2 — Active Source Certification",
    "",
    "Required **"+result.requiredActiveCount+"** · Registered **"+result.stats.expected+"** · Certified **"+result.stats.certified+"** · Failed **"+result.stats.failed+"** · Missing **"+result.stats.missing+"**",
    "",
    "| Source | Result | Positive checks | Reason |",
    "|---|---|---:|---|",
    ...result.rows.map(row=>"| "+scrub(row.id)+" | "+row.status+" | "+row.positiveChecks+"/2 | "+scrub(row.reason)+" |"),
    "",
    result.passed?"**ALL SOURCES CERTIFIED**":"**CERTIFICATION INCOMPLETE — DO NOT APPROVE SOURCES**",
    "",
  ].join("\n");
  console.log(markdown);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown);
  if(!result.passed)process.exitCode=1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
  console.error(error);process.exitCode=1;
});
