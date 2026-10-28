import {writeFile} from "node:fs/promises";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {EUROPE_SOURCES,summarizeEuropeanProbe} from "../src/europe-source-yield.mjs";

const argv=process.argv.slice(2);
const arg=(flag,defaultValue)=>{
  const n=argv.indexOf(flag);
  return n===-1?defaultValue:argv[n+1];
};
const unknown=argv.filter((value,index)=> !["--store","--output"].includes(value) &&
  !(index>0 && ["--store","--output"].includes(argv[index-1])));
if(unknown.length || argv.some((value,index)=>["--store","--output"].includes(value) && !argv[index+1]))
  throw Error("INVALID_ARGUMENTS");
const selected=arg("--store","all");
if(selected!=="all" && !Object.hasOwn(EUROPE_SOURCES,selected))throw Error("UNKNOWN_EUROPE_SOURCE");
const output=arg("--output","europe-source-yield.json");
const ids=selected==="all"?Object.keys(EUROPE_SOURCES):[selected];
const reports=[];
for(const id of ids){
  const started=Date.now();
  let result=null,error=null;
  try {
    // Three PDP resolutions maximum per merchant; sequential, no retry or transport switching.
    result=await searchFreeStorefrontById(id,EUROPE_SOURCES[id].query,{perStore:3});
  }catch(caught){error=caught}
  reports.push(summarizeEuropeanProbe(id,result,error,Date.now()-started));
}
const report={
  schemaVersion:"nawaa.europe-yield.v1",
  gitSha:process.env.GITHUB_SHA||null,
  observedAt:new Date().toISOString(),
  evidenceScope:"one search query per source; fields only; no independent merchant attestation",
  noInventoryMutation:true,noProductionActivation:true,
  sources:reports,
  summary:{sourcesChecked:reports.length,sourcesWithCompleteFields:reports.filter(r=>r.fieldsPass>0).length,
    totalCandidates:reports.reduce((n,r)=>n+r.candidates,0),
    fieldCompleteOffers:reports.reduce((n,r)=>n+r.fieldsPass,0)}
};
await writeFile(output,JSON.stringify(report,null,2)+"\n");
console.table(reports.map(({storeId,status,candidates,offersReturned,fieldsPass,unpricedSamples,errors})=>
  ({storeId,status,candidates,offersReturned,fieldsPass,unpricedSamples,errors})));
console.log(JSON.stringify({output,summary:report.summary}));
