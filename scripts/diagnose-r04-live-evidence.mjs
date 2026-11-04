// Read-only R04-P45 postprocessor. Run on an existing REAL production JSON report;
// NEVER contacts Render or merchants and NEVER changes shopper traffic or gates.
import {readFileSync,writeFileSync,statSync} from "node:fs";
import {diagnoseR04Evidence} from "./r04-causal-diagnostics.mjs";

const path=process.argv[2]||"r04-36-live-corpus-evidence.json";
const MAX_BYTES=2_000_000;
const jsonFile="r04-causal-diagnostic.json";
const markdownFile="r04-causal-diagnostic.md";
const formatNumber=n=>n===null?"unknown":String(n);
let output;
try{
  if(statSync(path).size>MAX_BYTES)throw Error("INPUT_TOO_LARGE");
  output=diagnoseR04Evidence(JSON.parse(readFileSync(path,"utf8")));
  if(output.sample.sourceErrorReconciliation==="MISMATCH")
    process.exitCode=1;
}catch(error){
  // Redact all arbitrary error text before reporting a failed audit.
  const safeErrors=new Set([
    "INPUT_TOO_LARGE","DIAGNOSTIC_SCHEMA_INVALID","DIAGNOSTIC_SHA_INVALID",
    "DIAGNOSTIC_CORPUS_SHAPE_INVALID","DIAGNOSTIC_PROVENANCE_NOT_VERIFIED",
    "DIAGNOSTIC_INTENT_ID_INVALID",
  ]);
  output={schemaVersion:"nawaa.r04.causal-diagnostic.v1",
    classification:"DIAGNOSTIC_INVALID_NOT_A_PRODUCTION_PASS",
    failureCode:safeErrors.has(error?.message)?error.message:"DIAGNOSTIC_INPUT_OR_PROCESSING_FAILURE",
    investigations:[],rows:[],limitations:["No conclusion from unverified or incomplete evidence."]};
  process.exitCode=1;
}
writeFileSync(jsonFile,JSON.stringify(output,null,2)+"\n");
const lines=[
  "# NAWAA R04 — Evidence-first diagnostic review",
  "",
  "**Evidence level:** "+output.classification,
  "",
];
if(output.provenance){
  lines.push("**Exact production SHA:** "+output.provenance.expectedSha,
    "**Observed queries:** "+output.provenance.observed+"/"+output.provenance.corpusIntents,
    "**Sample P50 / P95 (not population latency):** "+
      formatNumber(output.sample.sampleP50Ms)+" / "+
      formatNumber(output.sample.sampleP95Ms)+" ms",
    "**Principal misses:** "+output.sample.missingPrincipal,
    "**Internal deadlines:** "+output.sample.internalDeadlines,
    "**Source-error events / truncated tail:** "+
      output.sample.sourceErrorEvents+" / "+
      output.sample.sourceErrorEventsOutsideTop32,
    "**Source event accounting:** "+output.sample.sourceErrorReconciliation,
    "",
    "## Priority investigations (symptoms, not causal conclusions)",
    "",
    "| Signal | Affected intents | Triage score | Required next probe |",
    "| --- | ---: | ---: | --- |");
  for(const x of output.investigations)
    lines.push("| "+x.code+" | "+x.affectedIntents+" | "+x.priorityPoints+
      " | "+x.nextProbe+" |");
  lines.push("","## Impacted intent IDs","","| ID | Principal groups | Source errors | Signals |",
    "| --- | ---: | ---: | --- |");
  for(const row of output.rows.filter(x=>x.signals.length))
    lines.push("| "+row.id+" | "+formatNumber(row.principalGroups)+" | "+
      formatNumber(row.sourceErrors)+" | "+row.signals.map(x=>x.code).join(", ")+" |");
}else lines.push("**Failure:** "+output.failureCode);
lines.push("","## Evidence limits","",...(output.limitations||[]).map(x=>"- "+x));
writeFileSync(markdownFile,lines.join("\n")+"\n");
console.log("R04_P45_DIAGNOSTIC "+JSON.stringify({
  classification:output.classification,sha:output.provenance?.expectedSha||null,
  issues:output.investigations?.slice(0,8),failureCode:output.failureCode||null,
  intentCount:output.provenance?.observed||0,
}));
