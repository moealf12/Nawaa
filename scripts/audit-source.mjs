import { execFileSync } from "node:child_process";
import { writeFile, writeSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { currentSources } from "../server/source-config.mjs";
import { sourceCoverageSummary } from "../src/source-registry.mjs";
import { probeSource } from "../server/source-probe.mjs";

const root=fileURLToPath(new URL("..",import.meta.url));
const args=process.argv.slice(2), values={}, flags=new Set();
const options=new Set(["--source","--query","--expected","--output","--timeout-ms"]);
const bools=new Set(["--list","--catalog-only","--compare-production"]);
try {
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(bools.has(key)) {flags.add(key);continue;}
    if(!options.has(key) || !args[i+1] || args[i+1].startsWith("--")) throw new Error("Invalid audit arguments");
    values[key]=args[++i];
  }
  const revision=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  const worktreeDirty=Boolean(execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim());
  const sources=currentSources();
  if(flags.has("--list")) {
    writeSync(1,JSON.stringify({schemaVersion:"nawaa.source-catalog.v1",revision,worktreeDirty,coverage:sourceCoverageSummary(sources),sources},null,2)+"\n");
    process.exit(0);
  }
  if(!sources.some(source=>source.id===values["--source"])) throw new Error("Unknown source ID");
  if(!values["--query"]) throw new Error("Audit query is required");
  const timeoutMs=Number(values["--timeout-ms"] || 120000);
  if(!Number.isInteger(timeoutMs) || timeoutMs<100 || timeoutMs>180000) throw new Error("Invalid audit timeout");
  const expected=values["--expected"] || "results";
  const report=await probeSource({sourceId:values["--source"],query:values["--query"],expected,revision,timeoutMs,verifyPages:!flags.has("--catalog-only")});
  report.worktreeDirty=worktreeDirty;
  report.executionEnvironment="local-cli";
  if(flags.has("--compare-production")) {
    try {
      const response=await fetch("https://nawaa-search-api.onrender.com/health",{signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new Error("Production health unavailable");
      const health=await response.json();
      report.productionComparison={revision:health.revision || null,sameRevision:health.revision===revision&&!worktreeDirty};
    } catch {report.productionComparison={revision:null,sameRevision:null,error:"HEALTH_UNAVAILABLE"};}
  }
  const output=JSON.stringify(report,null,2)+"\n";
  if(values["--output"]) await promisify(writeFile)(values["--output"],output);
  writeSync(1,output);
  // End any outstanding adapter work after the bounded audit report is persisted.
  process.exit(["VERIFIED_SAMPLE","VALID_CATALOG_SAMPLE","NEGATIVE_CONTROL_PASS"].includes(report.status)?0:["UNCONNECTED","NOT_CONFIGURED"].includes(report.status)?3:1);
} catch(error) {
  const known=["Invalid audit arguments","Unknown source ID","Audit query is required","Invalid audit query","Invalid expected outcome","Invalid audit timeout"];
  writeSync(2,(known.includes(error.message)?error.message:"Audit command failed")+"\n");
  process.exit(2);
}
