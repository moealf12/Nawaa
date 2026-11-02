// R06-D production acceptance: read-only, bounded, sequential and exact-SHA.
// This certifies sampled transport/coverage invariants, NOT identical offers
// across independently timed JSON and SSE acquisitions or merchant price truth.
import {writeFileSync} from "node:fs";
import {assessCustomerSearchPayload} from "./r06-live-contract.mjs";

const ORIGIN="https://nawaa-search-api.onrender.com";
const EXPECTED=process.env.NAWAA_EXPECT_LIVE_SHA||"";
const MAX_BYTES=3_000_000, JSON_TIMEOUT=26_000, SSE_TIMEOUT=23_000;
const QUERIES=[
  ["I01","iPhone"],["G01","PS5"],["A01","سماعات بلوتوث"],
  ["A02","bluetooth headphones"],["C01","laptop"],["C02","لابتوب"],
];
const SSE_IDS=new Set(["I01","G01","A01","C01"]);
const safeClass=e=>String(e?.name||"UNKNOWN").replace(/[^A-Za-z0-9_-]/g,"").slice(0,35);
const counts={json:0,sse:0};
const evidence={schemaVersion:"nawaa.r06d.live.v1",mode:"READ_ONLY_PRODUCTION",
  expectedSha:EXPECTED,startedAt:new Date().toISOString(),health:null,
  json:[],sse:[],checks:[],limitations:[
    "Sequential live requests are not content-equivalent snapshots; no exact JSON/SSE offer equality asserted.",
    "No production failures are injected and no global product recall or P95 claim is established.",
  ]};

async function readBody(res,deadlineMs,{stopAtDone=false}={}){
  const controllerDeadline=Date.now()+deadlineMs;
  const decoder=new TextDecoder();
  let text="",bytes=0;
  if(res.body)for await(const chunk of res.body){
    bytes+=chunk.byteLength;
    if(bytes>MAX_BYTES)throw Error("RESPONSE_TOO_LARGE");
    text+=decoder.decode(chunk,{stream:true});
    if(stopAtDone && /(?:^|\n)event:\s*done\r?\n/m.test(text)&&/\r?\n\r?\n/.test(text.slice(-200)))break;
    if(Date.now()>controllerDeadline)throw Error("RESPONSE_DEADLINE");
  }
  return text;
}
async function request(path,accept,timeoutMs,{stream=false}={}){
  const signal=AbortSignal.timeout(timeoutMs);
  const started=Date.now();
  const response=await fetch(new URL(path,ORIGIN),{
    headers:{accept,"cache-control":"no-cache"},redirect:"error",signal,
  });
  if(Number(response.headers.get("content-length")||0)>MAX_BYTES)
    throw Error("RESPONSE_TOO_LARGE");
  const raw=await readBody(response,timeoutMs,{stopAtDone:stream});
  return {status:response.status,contentType:response.headers.get("content-type")||"",
    text:raw,elapsedMs:Date.now()-started};
}
function parseFrames(body){
  const frames=[];
  for(const part of body.replace(/\r\n/g,"\n").split("\n\n")){
    const kind=part.match(/^event:\s*(.+)$/m)?.[1];
    if(!kind)continue;
    const value=part.split("\n").filter(x=>x.startsWith("data:"))
      .map(x=>x.slice(5).trimStart()).join("\n");
    if(kind==="snapshot")frames.push({kind,payload:JSON.parse(value)});
    else if(kind==="done")frames.push({kind});
    else if(kind==="error")frames.push({kind});
  }
  return frames;
}
async function jsonProbe(id,query,label="first"){
  const row={id,label,kind:"JSON",status:"REQUEST_FAILED",pass:false,offers:null,
    failures:[],elapsedMs:null};
  try{
    const result=await request("/api/search?q="+encodeURIComponent(query),
      "application/json",JSON_TIMEOUT);
    row.status=result.status;row.elapsedMs=result.elapsedMs;
    if(result.status!==200||!result.contentType.includes("application/json"))
      throw Error("JSON_HTTP_OR_TYPE");
    const body=JSON.parse(result.text);
    const verdict=assessCustomerSearchPayload(body);
    Object.assign(row,{offers:verdict.offers,partial:verdict.partial,complete:verdict.complete,
      pending:verdict.providersPending,sourceErrors:verdict.sourceErrors,
      cacheMode:verdict.cacheMode,failures:verdict.failures,
      pass:verdict.pass&&verdict.offers>0});
    if(verdict.pass&&verdict.offers===0)row.failures.push("ZERO_VISIBLE_OFFERS");
  }catch(e){row.failures.push(safeClass(e));}
  counts.json++;evidence.json.push(row);
  console.log("R06D_JSON "+JSON.stringify(row));
  return row;
}
async function sseProbe(id,query){
  const row={id,kind:"SSE",status:"REQUEST_FAILED",pass:false,offers:null,
    snapshots:0,done:false,failures:[],elapsedMs:null};
  try{
    const result=await request("/api/search/stream?q="+encodeURIComponent(query),
      "text/event-stream",SSE_TIMEOUT,{stream:true});
    row.status=result.status;row.elapsedMs=result.elapsedMs;
    if(result.status!==200||!result.contentType.includes("text/event-stream"))
      throw Error("SSE_HTTP_OR_TYPE");
    const frames=parseFrames(result.text);
    const snapshots=frames.filter(x=>x.kind==="snapshot");
    const last=snapshots.at(-1)?.payload;
    row.snapshots=snapshots.length;row.done=frames.some(x=>x.kind==="done");
    if(!last)throw Error("SSE_MISSING_SNAPSHOT");
    const verdict=assessCustomerSearchPayload(last,{stream:true});
    Object.assign(row,{offers:verdict.offers,partial:verdict.partial,
      complete:verdict.complete,pending:verdict.providersPending,
      sourceErrors:verdict.sourceErrors,failures:verdict.failures,
      pass:verdict.pass&&row.done&&row.snapshots>=1&&verdict.offers>0});
    if(!row.done)row.failures.push("SSE_MISSING_DONE");
    if(verdict.pass&&verdict.offers===0)row.failures.push("ZERO_VISIBLE_OFFERS");
  }catch(e){row.failures.push(safeClass(e));}
  counts.sse++;evidence.sse.push(row);
  console.log("R06D_SSE "+JSON.stringify(row));
  return row;
}
try{
  if(!/^[a-f0-9]{40}$/.test(EXPECTED))throw Error("EXPECTED_SHA_REQUIRED");
  const h=await request("/health","application/json",15_000);
  const parsed=JSON.parse(h.text);
  evidence.health={status:h.status,ok:parsed?.ok===true,revision:parsed?.revision??null};
  const shaOk=h.status===200&&parsed?.ok===true&&parsed.revision===EXPECTED;
  evidence.checks.push({name:"EXACT_LIVE_SHA",pass:shaOk});
  if(!shaOk)throw Error("LIVE_SHA_MISMATCH");
  for(const [id,query] of QUERIES)await jsonProbe(id,query);
  // A repeated partial query must not be incorrectly read as a fresh complete cache hit.
  const first=evidence.json.find(x=>x.id==="G01");
  if(first?.partial===true){
    const repeated=await jsonProbe("G01","PS5","repeat_partial");
    evidence.checks.push({name:"PARTIAL_NOT_FRESH",pass:repeated.cacheMode!=="fresh"&&repeated.pass});
  }else evidence.checks.push({name:"PARTIAL_NOT_FRESH",pass:null,reason:"NO_PARTIAL_PS5_OBSERVED"});
  for(const [id,query] of QUERIES)if(SSE_IDS.has(id))await sseProbe(id,query);
}catch(e){
  evidence.fatal=safeClass(e);
  console.log("R06D_FATAL "+evidence.fatal);
}
evidence.completedAt=new Date().toISOString();
evidence.summary={jsonAttempts:counts.json,jsonPass:evidence.json.filter(x=>x.pass).length,
  sseAttempts:counts.sse,ssePass:evidence.sse.filter(x=>x.pass).length,
  exactSha:evidence.checks.find(x=>x.name==="EXACT_LIVE_SHA")?.pass===true,
  partialRecheck:evidence.checks.find(x=>x.name==="PARTIAL_NOT_FRESH")?.pass??null,
  fatal:evidence.fatal??null};
evidence.summary.result=evidence.summary.exactSha&&
  evidence.summary.jsonPass===evidence.summary.jsonAttempts&&counts.json>=6&&
  evidence.summary.ssePass===4&&evidence.summary.partialRecheck!==false?"PASS":"FAIL";
writeFileSync("r06-live-partial-acceptance.json",JSON.stringify(evidence,null,2)+"\n");
console.log("R06D_SUMMARY "+JSON.stringify(evidence.summary));
if(evidence.summary.result!=="PASS")process.exitCode=1;
