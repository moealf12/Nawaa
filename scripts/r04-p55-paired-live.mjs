// P55 paired independent live source evidence (two isolated Node processes).
// No fixtures, no replay, no DB or production writes. Both revisions contact
// public merchants under identical bounded request/transport configuration.
// A network success or JSON parse is not a product-truth certificate.
import {spawn,execFileSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {groupComparableOffers} from "../src/search-core.mjs";
import {buildSearchPresentationSections} from "../src/search-result-presentation.mjs";
import {classifyResultGroup} from "../src/search-result-intelligence.mjs";

const candidateSha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const baselineSha=process.env.P55_BASELINE_SHA||"";
const baselineDir=process.env.P55_BASELINE_DIR||"";
if(!/^[0-9a-f]{40}$/.test(baselineSha)||!baselineDir)
  throw Error("EXACT_BASELINE_REQUIRED");
const baseActual=execFileSync("git",["-C",baselineDir,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(baseActual!==baselineSha||baselineSha===candidateSha)
  throw Error("BASELINE_SHA_MISMATCH");
const frozen=JSON.parse(readFileSync(new URL("../engineering/execution/search-truth-corpus.json",import.meta.url),"utf8"));
const original=Array.isArray(frozen)?frozen:frozen.queryCases||frozen.intents||frozen.queries||[];
if(original.length!==36||new Set(original.map(x=>x.id)).size!==36)
  throw Error("FROZEN_36_CORPUS_INVALID");
const open=[
  ["X01","مكواة بخار تيفال"],["X02","قطاعة خضار كهربائية"],
  ["X03","منظم كابلات مكتب"],["X04","طقم مفكات دقيق"],
  ["X05","راوتر واي فاي 7 شبكي"],["X06","كتاب طبخ عربي"],
  ["X07","mechanical keyboard 75 percent"],["X08","guitar reverb pedal"],
  ["X09","portable solar panel 100W"],["X10","LEGO star wars 75355"],
  ["X11","shampoing sans sulfate"],["X12","funda para tablet samsung"],
];
const novel=[
  ["N01","مضخة مياه غاطسة 1 حصان"],["N02","سيروم فيتامين سي للبشرة"],
  ["N03","دراجة اطفال 16 بوصة"],["N04","مرحاض قطط ذاتي التنظيف"],
  ["N05","قاطع ليزر صغير"],["N06","موازين مطبخ رقمية"],
  ["N07","cordless impact wrench 20V"],["N08","organic green tea 500g"],
  ["N09","robot vacuum mop combo"],["N10","HDMI 2.1 splitter 4k"],
  ["N11","chaussures randonnée imperméables"],["N12","soporte coche teléfono"],
];
const cases=[
  ...original.map(({id,query})=>({id,query,cohort:"frozen36"})),
  ...open.map(([id,query])=>({id,query,cohort:"open12"})),
  ...novel.map(([id,query])=>({id,query,cohort:"novel12"})),
];
const LIMIT_BYTES=3_000_000,HTTP_TIMEOUT=18000,ports={baseline:18754,candidate:18755};
const children=[];
const runtimeEnv=port=>({
  ...process.env,PORT:String(port),NODE_ENV:"test",
  DATABASE_URL:"",MEILI_HOST:"",MEILI_MASTER_KEY:"",FIRECRAWL_API_KEY:"",
  PYTHON_WORKER_URL:"",NAWAA_PY_LIVE_ENABLED:"0",
  NAWAA_GOOGLE_SHOPPING_RESULTS_ENABLED:"0",SERPAPI_API_KEY:"",
  SEARCH_STREAM_DEADLINE_MS:"11000",
});
function start(kind,dir){
  const proc=spawn(process.execPath,["server/server.mjs"],{
    cwd:dir,env:runtimeEnv(ports[kind]),stdio:["ignore","pipe","pipe"],
  });
  let output="";
  for(const which of ["stdout","stderr"])
    proc[which].on("data",data=>{output=(output+String(data)).slice(-2800);});
  children.push(proc);
  return {proc,output:()=>output};
}
async function ready(kind,worker){
  for(let n=0;n<65;n++){
    if(worker.proc.exitCode!==null)throw Error(kind+"_SERVER_EXIT_"+worker.output().slice(-300));
    try{
      const r=await fetch("http://127.0.0.1:"+ports[kind]+"/health",{
        signal:AbortSignal.timeout(1000),redirect:"error"});
      if(r.ok)return;
    }catch{}
    await sleep(300);
  }
  throw Error(kind+"_SERVER_NOT_READY_"+worker.output().slice(-300));
}
async function responseJson(url){
  const response=await fetch(url,{headers:{accept:"application/json"},
    redirect:"error",signal:AbortSignal.timeout(HTTP_TIMEOUT)});
  if(Number(response.headers.get("content-length")||0)>LIMIT_BYTES)
    throw Error("DECLARED_RESPONSE_TOO_LARGE");
  const buf=await response.arrayBuffer();
  if(buf.byteLength>LIMIT_BYTES)throw Error("RESPONSE_TOO_LARGE");
  const body=JSON.parse(new TextDecoder().decode(buf));
  if(response.status!==200||!Array.isArray(body?.offers))
    throw Error("INVALID_SEARCH_RESULT");
  return body;
}
function countInto(into,key){
  const k=String(key||"unknown").slice(0,65);
  into[k]=(into[k]||0)+1;
}
function evidence(query,body){
  for(const offer of body.offers){
    if(!offer||!Number.isFinite(offer.productPrice)||offer.productPrice<=0||
       offer.currency!=="SAR"||!/^https:\/\//.test(String(offer.sourceUrl||"")))
      throw Error("UNVERIFIED_OFFER_IN_CUSTOMER_OUTPUT");
  }
  const groups=groupComparableOffers(body.offers,"lowest");
  const p=buildSearchPresentationSections(query,groups);
  if(p.partitionedGroups!==groups.length)
    throw Error("LOST_RESULT_PARTITION");
  const stage={totalOffers:body.offers.length,groups:groups.length,
    principals:p.exactGroups.length,related:p.relatedGroups.length,
    exactScored:0,unknownCondition:0,requestedConditionCount:0,
    decisionReasons:{},priceEvidence:{},sourceFailures:{},
    partial:body.coverage?.partial===true,
    deadlineExceeded:body.coverage?.deadlineExceeded===true,
    providersPending:body.coverage?.providersPending??null,
    sourceErrorCount:Array.isArray(body.errors)?body.errors.length:null};
  for(const offer of body.offers){
    if(offer.exactMatch===true&&Number(offer.matchConfidence)>=0.9)stage.exactScored++;
    if(!offer.condition||offer.condition==="unknown")stage.unknownCondition++;
    if(offer.condition===(p.intent.condition||"new"))stage.requestedConditionCount++;
    countInto(stage.priceEvidence,offer.sourceMeta?.priceEvidence||"UNSPECIFIED");
  }
  for(const group of groups)countInto(stage.decisionReasons,classifyResultGroup(query,group,p.intent).reason);
  for(const err of body.errors||[])countInto(stage.sourceFailures,err.failureClass||err.errorCode||"UNCLASSIFIED");
  return stage;
}
async function probe(kind,item){
  const started=Date.now();
  try{
    const body=await responseJson("http://127.0.0.1:"+ports[kind]+
      "/api/search?q="+encodeURIComponent(item.query));
    return {status:"OBSERVED",elapsedMs:Date.now()-started,...evidence(item.query,body)};
  }catch(err){
    return {status:"FAILED",reason:String(err?.message||"UNKNOWN").slice(0,90),
      elapsedMs:Date.now()-started};
  }
}
async function probeSse(kind,query){
  const res=await fetch("http://127.0.0.1:"+ports[kind]+
    "/api/search/stream?q="+encodeURIComponent(query),{
      headers:{accept:"text/event-stream"},redirect:"error",
      signal:AbortSignal.timeout(25000)});
  if(res.status!==200)throw Error("SSE_HTTP_"+res.status);
  const bytes=await res.arrayBuffer();
  if(bytes.byteLength>LIMIT_BYTES*2)throw Error("SSE_RESPONSE_TOO_LARGE");
  const text=new TextDecoder().decode(bytes);
  let last=null,done=false;
  for(const item of text.split(/\n\n/)){
    const event=item.match(/^event: ([^\n]+)/m)?.[1];
    const line=item.match(/^data: (.+)$/m)?.[1];
    if(event==="done")done=true;
    if(event==="snapshot"&&line){
      const snapshot=JSON.parse(line);
      if(!Array.isArray(snapshot.offers))throw Error("SSE_BAD_SNAPSHOT");
      last=evidence(query,snapshot);
    }
  }
  if(!done||!last)throw Error("SSE_NO_FINAL_SNAPSHOT");
  return {status:"OBSERVED",...last};
}
const rows=[],sse=[];
let fatal=null;
try{
  const workers={baseline:start("baseline",resolve(baselineDir)),
    candidate:start("candidate",process.cwd())};
  await Promise.all(Object.entries(workers).map(([k,w])=>ready(k,w)));
  for(const item of cases){
    // Paired simultaneous probes reduce (but never eliminate) upstream-time
    // drift. Both revisions have independent caches and per-source circuit state.
    const [baseline,candidate]=await Promise.all([
      probe("baseline",item),probe("candidate",item)]);
    rows.push({id:item.id,cohort:item.cohort,baseline,candidate});
    console.log("R04_P55_PAIR "+JSON.stringify({
      id:item.id,cohort:item.cohort,
      baseline:[baseline.status,baseline.principals??null,baseline.sourceErrorCount??null],
      candidate:[candidate.status,candidate.principals??null,candidate.sourceErrorCount??null],
    }));
  }
  // SSE and JSON are independent live requests, never assume identical stock
  // across time; validate shared schema, partition, and result safety instead.
  for(const id of ["Q01","Q17","X10","N07"]){
    const item=cases.find(x=>x.id===id);
    if(!item)throw Error("PARITY_INTENT_MISSING_"+id);
    const responses=await Promise.allSettled([
      probeSse("baseline",item.query),probeSse("candidate",item.query)]);
    sse.push({id,baseline:responses[0].status==="fulfilled"?responses[0].value:
      {status:"FAILED",reason:String(responses[0].reason).slice(0,90)},
      candidate:responses[1].status==="fulfilled"?responses[1].value:
      {status:"FAILED",reason:String(responses[1].reason).slice(0,90)}});
  }
}catch(e){fatal=String(e?.message||e).slice(0,180);}
finally{
  for(const proc of children){if(proc.exitCode===null)proc.kill("SIGTERM");}
  await sleep(400);
  for(const proc of children){if(proc.exitCode===null)proc.kill("SIGKILL");}
}
const aggregate=(kind,items)=>{
  const observed=items.filter(r=>r[kind].status==="OBSERVED");
  return {observed:observed.length,principalQueries:observed.filter(r=>r[kind].principals>0).length,
    principalGroups:observed.reduce((n,r)=>n+r[kind].principals,0),
    sourceErrorEvents:observed.reduce((n,r)=>n+(r[kind].sourceErrorCount||0),0),
    partial:observed.filter(r=>r[kind].partial).length,
    unknownCondition:observed.reduce((n,r)=>n+r[kind].unknownCondition,0)};
};
const cohorts={};
for(const cohort of ["frozen36","open12","novel12"]){
  const matching=rows.filter(r=>r.cohort===cohort);
  cohorts[cohort]={count:matching.length,baseline:aggregate("baseline",matching),
    candidate:aggregate("candidate",matching),
    principalGains:matching.filter(r=>r.baseline.status==="OBSERVED"&&
      r.candidate.status==="OBSERVED"&&r.candidate.principals>r.baseline.principals).length,
    principalRegressions:matching.filter(r=>r.baseline.status==="OBSERVED"&&
      r.candidate.status==="OBSERVED"&&r.candidate.principals<r.baseline.principals).length};
}
const failures=rows.filter(r=>r.baseline.status!=="OBSERVED"||r.candidate.status!=="OBSERVED")
  .map(r=>r.id);
const sseFailures=sse.filter(r=>r.baseline.status!=="OBSERVED"||r.candidate.status!=="OBSERVED")
  .map(r=>r.id);
const totalGains=Object.values(cohorts).reduce((n,c)=>n+c.principalGains,0);
const totalRegressions=Object.values(cohorts).reduce((n,c)=>n+c.principalRegressions,0);
const summary={schemaVersion:"nawaa.r04.p55.paired-live.v1",
  baselineSha,candidateSha,execution:"TWO_DISPOSABLE_LIVE_MERCHANT_PROCESSES",
  sampleSize:cases.length,cohorts,fatal,failedRequests:failures,
  sseFailures,totalGains,totalRegressions,
  structuralPass:!fatal&&rows.length===60&&failures.length===0&&sseFailures.length===0,
  acquisitionCertified:false,independentProductTruthCertified:false,
  reviewerDecision:!fatal&&rows.length===60&&failures.length===0&&sseFailures.length===0&&
      totalGains>0&&totalRegressions===0?"EVIDENCE_READY_FOR_REVIEW":"NO_GO",
};
writeFileSync("r04-p55-paired-live-evidence.json",JSON.stringify({...summary,rows,sse},null,2)+"\n");
console.log("R04_P55_SUMMARY "+JSON.stringify(summary));
if(!summary.structuralPass||summary.reviewerDecision==="NO_GO")process.exitCode=1;
