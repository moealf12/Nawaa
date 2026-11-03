// R04-P3.6: observe the actual PR code in a disposable local Node server.
// Unlike the frozen production audit, these requests hit the candidate,
// not Render's previously deployed main. No source retries, DB, Meili or writes.
// This is acquisition evidence, never human ranking/merchant certification.
import {spawn,execFileSync} from "node:child_process";
import {once} from "node:events";
import {readFileSync,writeFileSync} from "node:fs";
import net from "node:net";
import {groupComparableOffers} from "../src/search-core.mjs";
import {buildSearchPresentationSections} from "../src/search-result-presentation.mjs";
import {aggregateSourceErrorEvidence,mergeSourceErrorEvidence}
  from "./r04-source-failure-forensics.mjs";

const SHA=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(!/^[0-9a-f]{40}$/.test(SHA))throw Error("INVALID_CANDIDATE_SHA");
const corpus=JSON.parse(readFileSync(new URL("../engineering/execution/search-truth-corpus.json",import.meta.url),"utf8"));
if(!Array.isArray(corpus.queryCases)||corpus.queryCases.length!==36 ||
  new Set(corpus.queryCases.map(x=>x.id)).size!==36)throw Error("INVALID_FROZEN_CORPUS");
const PORT=await new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const p=server.address().port;
    server.close(()=>resolve(p));
  });
});
const base="http://127.0.0.1:"+PORT;
const child=spawn(process.execPath,["server/server.mjs"],{
  env:{...process.env,PORT:String(PORT),NODE_ENV:"test",
    DATABASE_URL:"",MEILI_HOST:"",MEILI_MASTER_KEY:"",
    NOON_ENABLED:"false",EBAY_ENABLED:"false",CARREFOUR_ENABLED:"false"},
  stdio:["ignore","pipe","pipe"],
});
child.stdout.on("data",()=>{}); // Drain pipe, never persist raw source logs.
child.stderr.on("data",()=>{});
const startedAt=new Date().toISOString(), rows=Array(36).fill(null);
const knownFailureNames=new Set(["TimeoutError","AbortError","SyntaxError","TypeError"]);
let fatal=null;

async function ready(){
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw Error("CANDIDATE_SERVER_EXITED");
    try{
      const res=await fetch(base+"/health",{signal:AbortSignal.timeout(1000)});
      const health=await res.json();
      if(res.status===200&&health?.ok===true)return;
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error("CANDIDATE_HEALTH_UNAVAILABLE");
}
async function probe(q){
  const started=Date.now();
  let phase="headers";
  try {
    const res=await fetch(base+"/api/search?q="+encodeURIComponent(q.query),{
      headers:{accept:"application/json","cache-control":"no-cache"},
      signal:AbortSignal.timeout(32000),redirect:"error",
    });
    phase="body";
    if(Number(res.headers.get("content-length")||0)>3_000_000)throw Error("RESPONSE_OVERSIZED");
    const bytes=await res.arrayBuffer();
    if(bytes.byteLength>3_000_000)throw Error("RESPONSE_OVERSIZED");
    phase="parse";
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(res.status!==200||!Array.isArray(body?.offers)||
      typeof body?.coverage?.partial!=="boolean")throw Error("INVALID_RESPONSE_CONTRACT");
    phase="validate";
    const valid=body.offers.every(o=>{
      if(typeof o?.title!=="string"||!o.title.trim()||
         !Number.isFinite(o.productPrice)||o.productPrice<=0||
         o.currency!=="SAR"||!o.merchant)return false;
      try {const url=new URL(o.sourceUrl);return url.protocol==="https:";}catch{return false;}
    });
    if(!valid)throw Error("INVALID_OFFER_CONTRACT");
    const grouped=groupComparableOffers(body.offers,"lowest");
    const sections=buildSearchPresentationSections(q.query,grouped);
    if(sections.partitionedGroups!==grouped.length)throw Error("PRESENTATION_PARTITION_LOSS");
    const failures=aggregateSourceErrorEvidence(body.errors);
    const row={
      id:q.id,group:q.group,language:q.language,status:"OBSERVED",
      elapsedMs:Date.now()-started,
      serverDurationMs:Number.isFinite(body.durationMs)?Math.round(body.durationMs):null,
      offers:body.offers.length,groups:grouped.length,
      primaryGroups:sections.exactGroups.length,relatedGroups:sections.relatedGroups.length,
      partial:body.coverage.partial,
      deadlineExceeded:body.coverage.deadlineExceeded===true,
      providersPending:body.coverage.providersPending??null,
      sourceErrors:failures.reported,sourceErrorBreakdown:failures,
    };
    console.log("R04_P36_CANDIDATE_QUERY "+JSON.stringify({
      id:row.id,status:row.status,elapsedMs:row.elapsedMs,
      offers:row.offers,primaryGroups:row.primaryGroups,partial:row.partial,
      deadlineExceeded:row.deadlineExceeded,sourceErrors:row.sourceErrors,
    }));
    return row;
  }catch(error){
    const name=knownFailureNames.has(error?.name)?error.name:"Error";
    const row={id:q.id,group:q.group,language:q.language,status:"REQUEST_FAILED",
      reason:name,phase,elapsedMs:Date.now()-started,
      offers:0,primaryGroups:null,sourceErrors:null,sourceErrorBreakdown:null,
      partial:null,deadlineExceeded:null};
    console.log("R04_P36_CANDIDATE_QUERY "+JSON.stringify(row));
    return row;
  }
}
try{
  await ready();
  let next=0;
  await Promise.all(Array.from({length:2},async()=>{
    while(next<36){const i=next++;rows[i]=await probe(corpus.queryCases[i]);}
  }));
}catch(error){fatal=knownFailureNames.has(error?.name)?error.name:"CANDIDATE_RUN_FAILED";}
finally{
  if(child.exitCode===null){child.kill("SIGTERM");await Promise.race([
    once(child,"exit").catch(()=>{}),
    new Promise(r=>setTimeout(r,2000)),
  ]);}
}
const observed=rows.filter(x=>x?.status==="OBSERVED");
const summary={
  attempted:rows.filter(Boolean).length,observed:observed.length,
  requestFailures:rows.filter(x=>x?.status==="REQUEST_FAILED").map(x=>x.id),
  partial:observed.filter(x=>x.partial).length,
  deadlineExceeded:observed.filter(x=>x.deadlineExceeded).length,
  sourceErrorEvents:observed.reduce((n,x)=>n+x.sourceErrors,0),
  observedOffers:observed.reduce((n,x)=>n+x.offers,0),
  intentsWithoutPrincipal:observed.filter(x=>x.primaryGroups===0).map(x=>x.id),
  failureAttribution:mergeSourceErrorEvidence(observed.map(x=>x.sourceErrorBreakdown)),
  result:!fatal&&observed.length===36
    ?"CANDIDATE_EVIDENCE_COLLECTED_NOT_CERTIFIED":"CANDIDATE_COLLECTION_FAILED",
};
const report={schemaVersion:"nawaa.r04.p36.disposable-candidate.v1",
  mode:"DISPOSABLE_CANDIDATE_ONLY",sha:SHA,startedAt,
  completedAt:new Date().toISOString(),source:"frozen-36-intent-corpus",
  databaseConfigured:false,meilisearchConfigured:false,
  notEvidenceOf:["currently deployed production code","same-environment causal A/B",
    "every merchant is accessible","human relevance certification","global p95 latency"],
  fatal,summary,rows};
writeFileSync("r04-p36-candidate-36-evidence.json",JSON.stringify(report,null,2)+"\n");
console.log("R04_P36_CANDIDATE_SUMMARY "+JSON.stringify({sha:SHA,...summary}));
if(summary.result!=="CANDIDATE_EVIDENCE_COLLECTED_NOT_CERTIFIED")process.exitCode=1;
