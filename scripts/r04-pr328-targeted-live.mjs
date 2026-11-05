// R04-P328: the missing customer-facing proof, and nothing beyond it.
// Two disposable servers, same public-source constraints, no DB/cache persistence,
// no fixtures, no retries, no paid providers. Each revision's OWN classifier
// is used to evaluate its response; never classify the baseline using candidate code.
import {spawn,execFileSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";

const cases=[
  {id:"S11",cohort:"target",query:"shampoing sans sulfate"},
  {id:"S12",cohort:"target",query:"funda para tablet samsung"},
  {id:"S13",cohort:"target",query:"chaussures randonnée imperméables"},
  {id:"C01",cohort:"control",query:"iPhone 17 256GB"},
  {id:"C02",cohort:"control",query:"Samsung Galaxy S25 Ultra"},
  {id:"C03",cohort:"control",query:"PS5 Digital Edition"},
];
const baselineSha=process.env.R04_BASELINE_SHA||"";
const baselineDir=process.env.R04_BASELINE_DIR||"";
const candidateSha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(!/^[a-f0-9]{40}$/.test(baselineSha)||!baselineDir)throw Error("EXACT_BASELINE_REQUIRED");
const actual=execFileSync("git",["-C",baselineDir,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(actual!==baselineSha||actual===candidateSha)throw Error("EXACT_BASELINE_MISMATCH");

const roots={baseline:resolve(baselineDir),candidate:process.cwd()};
const ports={baseline:18911,candidate:18912};
const children=[];
const initModules=async root=>{
  const load=async p=>import(pathToFileURL(resolve(root,p)).href);
  const [core,presentation,intelligence]=await Promise.all([
    load("src/search-core.mjs"),load("src/search-result-presentation.mjs"),
    load("src/search-result-intelligence.mjs"),
  ]);
  return {groupComparableOffers:core.groupComparableOffers,
    buildSearchPresentationSections:presentation.buildSearchPresentationSections,
    classifyResultGroup:intelligence.classifyResultGroup};
};
const modules={
  baseline:await initModules(roots.baseline),
  candidate:await initModules(roots.candidate),
};
function start(kind){
  const env={...process.env,PORT:String(ports[kind]),NODE_ENV:"test",
    DATABASE_URL:"",MEILI_HOST:"",MEILI_MASTER_KEY:"",
    FIRECRAWL_API_KEY:"",SERPAPI_API_KEY:"",PYTHON_WORKER_URL:"",
    NAWAA_PY_LIVE_ENABLED:"0",NAWAA_GOOGLE_SHOPPING_RESULTS_ENABLED:"0",
    SEARCH_STREAM_DEADLINE_MS:"11000",
  };
  const proc=spawn(process.execPath,["server/server.mjs"],{
    cwd:roots[kind],env,stdio:["ignore","pipe","pipe"],
  });
  let tail="";
  for(const k of ["stdout","stderr"])
    proc[k].on("data",d=>{tail=(tail+String(d)).slice(-2500);});
  children.push(proc);
  return {proc,tail:()=>tail};
}
async function waitReady(kind,worker){
  for(let i=0;i<65;i++){
    if(worker.proc.exitCode!==null)throw Error("SERVER_EXIT_"+kind+worker.tail().slice(-250));
    try{
      const r=await fetch("http://127.0.0.1:"+ports[kind]+"/health",{
        redirect:"error",signal:AbortSignal.timeout(1000)});
      if(r.ok)return;
    }catch{}
    await sleep(300);
  }
  throw Error("SERVER_NOT_READY_"+kind+worker.tail().slice(-250));
}
async function limitedBody(res,max=3_000_000){
  if(Number(res.headers.get("content-length")||0)>max)throw Error("RESPONSE_TOO_BIG");
  const bytes=await res.arrayBuffer();
  if(bytes.byteLength>max)throw Error("RESPONSE_TOO_BIG");
  return new TextDecoder().decode(bytes);
}
function evaluate(kind,query,response){
  const offers=response?.offers;
  if(!Array.isArray(offers))throw Error("OFFERS_NOT_ARRAY");
  for(const item of offers){
    if(!item||!Number.isFinite(item.productPrice)||item.productPrice<=0||
       item.currency!=="SAR"||!String(item.sourceUrl||"").startsWith("https://"))
      throw Error("INVALID_PUBLISHED_OFFER");
  }
  const m=modules[kind];
  const groups=m.groupComparableOffers(offers,"lowest");
  const presentation=m.buildSearchPresentationSections(query,groups);
  if(presentation.partitionedGroups!==groups.length)throw Error("GROUP_PARTITION_LOST");
  const decisions={};
  for(const group of groups){
    const label=m.classifyResultGroup(query,group).reason;
    decisions[label]=(decisions[label]||0)+1;
  }
  const failures={};
  for(const error of response.errors||[]){
    const reason=String(error.failureClass||error.errorCode||error.error||"UNSPECIFIED").slice(0,65);
    failures[reason]=(failures[reason]||0)+1;
  }
  return {
    offers:offers.length,groups:groups.length,
    principals:presentation.exactGroups.length,
    related:presentation.relatedGroups.length,
    scoredExact:offers.filter(o=>o.exactMatch===true&&o.matchConfidence>=0.9).length,
    partial:response.coverage?.partial===true,
    deadlineExceeded:response.coverage?.deadlineExceeded===true,
    providersPending:response.coverage?.providersPending??null,
    sourceErrorCount:Array.isArray(response.errors)?response.errors.length:null,
    decisions,failures,
  };
}
async function search(kind,item){
  const started=Date.now();
  try{
    const res=await fetch("http://127.0.0.1:"+ports[kind]+
      "/api/search?q="+encodeURIComponent(item.query),{
      redirect:"error",signal:AbortSignal.timeout(18_000),
      headers:{accept:"application/json"},
    });
    if(res.status!==200)throw Error("HTTP_"+res.status);
    const body=JSON.parse(await limitedBody(res));
    return {status:"OBSERVED",elapsedMs:Date.now()-started,
      ...evaluate(kind,item.query,body)};
  }catch(e){
    return {status:"FAILED",reason:String(e.message||e).slice(0,100),
      elapsedMs:Date.now()-started};
  }
}
async function stream(kind,item){
  try{
    const res=await fetch("http://127.0.0.1:"+ports[kind]+
      "/api/search/stream?q="+encodeURIComponent(item.query),{
      redirect:"error",signal:AbortSignal.timeout(25_000),
      headers:{accept:"text/event-stream"},
    });
    if(res.status!==200)throw Error("HTTP_"+res.status);
    let final=null,done=false;
    const raw=await limitedBody(res,6_000_000);
    for(const part of raw.split(/\n\n/)){
      const event=part.match(/^event: ([^\n]+)/m)?.[1];
      const line=part.match(/^data: (.+)$/m)?.[1];
      if(event==="snapshot"&&line){
        const object=JSON.parse(line);
        final=evaluate(kind,item.query,object);
      }
      if(event==="done")done=true;
    }
    if(!done||!final)throw Error("NO_FINAL_SSE_SNAPSHOT");
    return {status:"OBSERVED",...final};
  }catch(e){return {status:"FAILED",reason:String(e.message||e).slice(0,90)};}
}
const rows=[],sse=[];
let fatal=null;
try{
  const workers={baseline:start("baseline"),candidate:start("candidate")};
  await Promise.all(Object.entries(workers).map(([k,w])=>waitReady(k,w)));
  for(const item of cases){
    const [baseline,candidate]=await Promise.all([search("baseline",item),search("candidate",item)]);
    rows.push({...item,baseline,candidate});
    console.log("R04_TARGET_PAIR "+JSON.stringify({
      id:item.id,cohort:item.cohort,
      baseline:[baseline.status,baseline.offers??null,baseline.principals??null],
      candidate:[candidate.status,candidate.offers??null,candidate.principals??null],
    }));
  }
  // Exercise the separately implemented SSE publication boundary for one
  // multilingual target and one high-risk whole-device control.
  for(const id of ["S12","C01"]){
    const item=cases.find(c=>c.id===id);
    const [baseline,candidate]=await Promise.all([stream("baseline",item),stream("candidate",item)]);
    sse.push({id,baseline,candidate});
  }
}catch(e){fatal=String(e?.message||e).slice(0,180);}
finally{
  for(const p of children)if(p.exitCode===null)p.kill("SIGTERM");
  await sleep(400);
  for(const p of children)if(p.exitCode===null)p.kill("SIGKILL");
}
const failed=rows.filter(r=>r.baseline.status!=="OBSERVED"||r.candidate.status!=="OBSERVED").map(r=>r.id);
const lostControls=rows.filter(r=>r.cohort==="control"&&
  r.baseline.status==="OBSERVED"&&r.candidate.status==="OBSERVED"&&
  r.baseline.principals>0&&r.candidate.principals===0).map(r=>r.id);
const improvedTargets=rows.filter(r=>r.cohort==="target"&&
  r.baseline.status==="OBSERVED"&&r.candidate.status==="OBSERVED"&&
  r.candidate.principals>r.baseline.principals).map(r=>r.id);
const regressedTargets=rows.filter(r=>r.cohort==="target"&&
  r.baseline.status==="OBSERVED"&&r.candidate.status==="OBSERVED"&&
  r.candidate.principals<r.baseline.principals).map(r=>r.id);
const sseFailed=sse.filter(r=>r.baseline.status!=="OBSERVED"||r.candidate.status!=="OBSERVED").map(r=>r.id);
const structuralPass=!fatal&&rows.length===cases.length&&failed.length===0&&sseFailed.length===0;
const verdict=structuralPass&&improvedTargets.length>0&&lostControls.length===0&&regressedTargets.length===0
  ?"RECALL_IMPROVEMENT_REQUIRES_REVIEW":"NO_GO";
const summary={schemaVersion:"nawaa.r04.pr328.targeted-live.v1",
  baselineSha,candidateSha,execution:"EXACT_SHA_PAIRED_REAL_MERCHANTS",
  structuralPass,improvedTargets,regressedTargets,lostControls,
  failed,sseFailed,fatal,verdict,
  provenanceScope:"OBSERVED_RECALL_NOT_INDEPENDENT_MERCHANT_PDP_CERTIFICATION"};
writeFileSync("r04-pr328-targeted-live-evidence.json",JSON.stringify({...summary,rows,sse},null,2)+"\n");
console.log("R04_TARGET_SUMMARY "+JSON.stringify(summary));
if(verdict==="NO_GO")process.exitCode=1;
