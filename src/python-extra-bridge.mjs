// eXtra Python product evidence transport, bounded and explicitly source-owned.
// Standalone URL + product SKU only. No arbitrary source URLs, shell, or trust grants.
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {StringDecoder} from "node:string_decoder";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const CWD=fileURLToPath(new URL("../workers/python-intelligence/",import.meta.url));
const VERSION="nawaa.extra.pdp.v1";
const MAX_STDOUT_BYTES=128_000,MAX_STDERR_BYTES=8_192;
const SAFE_STAGES=new Set(["worker_ready","dns_start","dns_done","robots_start",
  "robots_done","pdp_start","pdp_done","parse_done","reply"]);
// Strictly parse only fixed stage names and bounded integers. Never log raw
// stderr, URLs, prices, identity, request IDs or Python exception messages.
export function parseExtraWorkerPhase(line){
  if(typeof line!=="string"||!line.startsWith("NAWAA_EXTRA_PHASE ")||line.length>200)return null;
  try{
    const value=JSON.parse(line.slice("NAWAA_EXTRA_PHASE ".length));
    if(!value||Object.keys(value).sort().join(",")!=="sinceBootMs,stage"||
      !SAFE_STAGES.has(value.stage)||!Number.isInteger(value.sinceBootMs)||
      value.sinceBootMs<0||value.sinceBootMs>120000)return null;
    return {stage:value.stage,sinceBootMs:value.sinceBootMs};
  }catch{return null;}
}
// Protect the shared free Render Node instance from simultaneous Python process floods.
let activeExtraPython=0;
const MAX_ACTIVE_EXTRA_PYTHON=2;
const PDP=/^\/en-sa\/(?:[a-z0-9-]+\/)+p\/(\d{5,12})\/?$/;

export function approvedExtraPdp(rawUrl,sku){
  if(typeof rawUrl!=="string"||typeof sku!=="string"||
     !/^\d{5,12}$/.test(sku)||rawUrl.length>2048)return false;
  try{
    const url=new URL(rawUrl);
    const match=url.pathname.match(PDP);
    return url.protocol==="https:"&&url.hostname==="www.extra.com"&&
      url.host==="www.extra.com"&&!url.username&&!url.password&&
      !url.search&&!url.hash&&match?.[1]===sku&&url.href===rawUrl;
  }catch{return false;}
}

// This alias is retained by the existing UNBXD normalizer and canonical
// identity system; never overwrite it with the slug URL from Python.
export function approvedExtraIndexUrl(rawUrl,sku){
  if(typeof rawUrl!=="string"||typeof sku!=="string"||
    !/^\d{5,12}$/.test(sku))return false;
  try{
    const u=new URL(rawUrl);
    return u.protocol==="https:"&&u.host==="www.extra.com"&&
      !u.username&&!u.password&&!u.search&&!u.hash&&
      u.pathname==="/en-sa/p/"+sku&&u.href===rawUrl;
  }catch{return false;}
}

export async function runExtraPythonPdp({url,expectedSku},{
  timeoutMs=3000,signal,
  pythonBin=process.env.RENDER==="true" || existsSync(join(CWD,".venv/bin/python"))
    ? join(CWD,".venv/bin/python") : "python3"
}={}){
  if(!approvedExtraPdp(url,expectedSku))throw Error("PYTHON_EXTRA_URL_SKU_REJECTED");
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>10000)
    throw Error("PYTHON_EXTRA_TIMEOUT_INVALID");
  if(typeof pythonBin!=="string"||
    !/^(?:python3(?:\.\d+)?|\/[A-Za-z0-9_./-]+)$/.test(pythonBin))
    throw Error("PYTHON_EXTRA_EXECUTABLE_INVALID");
  if(signal?.aborted)throw Error("PYTHON_EXTRA_ABORTED");
  const requestId=randomUUID();
  const input=JSON.stringify({
    schemaVersion:VERSION,requestId,sourceId:"extra-sa",url,
    expected_sku:expectedSku,timeoutMs:Math.min(timeoutMs,8000),
    maxResponseBytes:1_500_000
  })+"\n";
  if(Buffer.byteLength(input)>4096)throw Error("PYTHON_EXTRA_INPUT_LIMIT");
  // Reuse a pre-imported Python interpreter, retaining the same source-owned
  // JSONL contract, cancellation, deadline and evidence validation.
  if(extraWarmEnabled())return runExtraWarmRequest(input,requestId,timeoutMs,signal);


  if(activeExtraPython>=MAX_ACTIVE_EXTRA_PYTHON)
    throw Error("PYTHON_EXTRA_BUSY");
  activeExtraPython++;
  return new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawn(pythonBin,["-m","nawaa_py.extra_pdp"],{
        cwd:CWD,stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true,
        env:{PATH:process.env.PATH??"",PYTHONPATH:CWD,
             PYTHONUNBUFFERED:"1",PYTHONDONTWRITEBYTECODE:"1"}
      });
    }catch{
      activeExtraPython--;
      reject(Error("PYTHON_EXTRA_SPAWN_FAILED"));return;
    }
    const started=performance.now();
    let lastStage="spawn",lastPythonMs=null,readyMs=null,stderrBuffer="";
    let finished=false,stdout="",bytes=0,errBytes=0;
    const decoder=new StringDecoder("utf8");
    let timer;
    const finish=(error,value)=>{
      if(finished)return;
      finished=true;
      activeExtraPython--;
      clearTimeout(timer);
      const elapsedMs=Math.max(0,Math.round(performance.now()-started));
      if(error && process.env.RENDER==="true" &&
        ["PYTHON_EXTRA_TIMEOUT","PYTHON_EXTRA_SOURCE_HTTP_TIMEOUT",
         "PYTHON_EXTRA_EXIT_NONZERO"].includes(error.message)){
        console.info("NAWAA_EXTRA_PYTHON_PHASE "+JSON.stringify({
          outcome:error.message,stage:lastStage,elapsedMs,
          pythonBootMs:lastPythonMs,readyMs
        }));
      }
      signal?.removeEventListener("abort",abort);
      if(error){if(!child.killed)child.kill("SIGKILL");reject(error);}
      else resolve(value);
    };
    const abort=()=>finish(Error("PYTHON_EXTRA_ABORTED"));
    signal?.addEventListener("abort",abort,{once:true});
    timer=setTimeout(()=>finish(Error("PYTHON_EXTRA_TIMEOUT")),timeoutMs);
    child.on("error",()=>finish(Error("PYTHON_EXTRA_SPAWN_FAILED")));
    child.stdout.on("data",chunk=>{
      bytes+=chunk.byteLength;
      if(bytes>MAX_STDOUT_BYTES)return finish(Error("PYTHON_EXTRA_OUTPUT_LIMIT"));
      stdout+=decoder.write(chunk);
    });
    child.stderr.on("data",chunk=>{
      errBytes+=chunk.byteLength;
      if(errBytes>MAX_STDERR_BYTES)return finish(Error("PYTHON_EXTRA_STDERR_LIMIT"));
      const lines=(stderrBuffer+chunk.toString("utf8")).split(/\r?\n/);
      stderrBuffer=lines.pop().slice(-256);
      for(const line of lines){
        const event=parseExtraWorkerPhase(line);
        if(event && event.stage!=="reply"){
          lastStage=event.stage;
          lastPythonMs=event.sinceBootMs;
          if(event.stage==="worker_ready")readyMs=Math.round(performance.now()-started);
        }
      }
    });
    child.stdin.on("error",()=>finish(Error("PYTHON_EXTRA_STDIN_FAILURE")));
    child.on("close",code=>{
      if(finished)return;
      stdout+=decoder.end();
      if(code!==0)return finish(Error("PYTHON_EXTRA_EXIT_NONZERO"));
      const lines=stdout.split(/\r?\n/).filter(Boolean);
      if(lines.length!==1)return finish(Error("PYTHON_EXTRA_JSONL_INVALID"));
      let reply;
      try{reply=JSON.parse(lines[0]);}
      catch{return finish(Error("PYTHON_EXTRA_JSON_INVALID"));}
      if(!reply||reply.schemaVersion!==VERSION||
         reply.requestId!==requestId||reply.sourceId!=="extra-sa"||
         !["EVIDENCE_FOUND","INSUFFICIENT_EVIDENCE","ERROR"].includes(reply.status))
        return finish(Error("PYTHON_EXTRA_CONTRACT_INVALID"));
      if(reply.status==="ERROR")
        return finish(Error(
          typeof reply.errorCode==="string"&&/^[A-Z0-9_]{3,80}$/.test(reply.errorCode)
            ? "PYTHON_EXTRA_SOURCE_"+reply.errorCode : "PYTHON_EXTRA_SOURCE_FAILURE"
        ));
      if(!reply.evidence||typeof reply.evidence!=="object"||
        Array.isArray(reply.evidence))
        return finish(Error("PYTHON_EXTRA_EVIDENCE_INVALID"));
      finish(null,reply.evidence);
    });
    child.stdin.end(input);
  });
}


// Exactly one resident Python worker on the existing Render free Node instance.
// No separate service or worker queue: while busy, the original UNBXD offer
// survives rather than blocking or spawning additional interpreters.
const WARM_SERVICE="srv-dau4olo93c1s73cnj9a0";
const WARM_MAX_REQUESTS=8; // Must match Python MAX_REQUESTS.
let extraWarm=null,warmRestartTimer=null;
function extraWarmEnabled(){
  return process.env.RENDER==="true"&&
    process.env.RENDER_SERVICE_ID===WARM_SERVICE&&
    process.env.NAWAA_EXTRA_PYTHON_PDP==="1"&&
    process.env.NAWAA_EXTRA_PYTHON_WARM==="1";
}
function scheduleExtraWarmRestart(delayMs){
  if(!extraWarmEnabled()||warmRestartTimer)return;
  warmRestartTimer=setTimeout(()=>{
    warmRestartTimer=null;
    startExtraPythonWarmWorker();
  },delayMs);
  warmRestartTimer.unref?.();
}
function finishWarmRequest(state,error,value){
  const p=state.pending;
  if(!p)return;
  state.pending=null;
  clearTimeout(p.timer);
  p.signal?.removeEventListener("abort",p.abort);
  if(error)p.reject(error);
  else p.resolve(value);
}
function terminateExtraWarm(state,reason,delayMs=15000){
  if(state.dead)return;
  state.dead=true;
  clearTimeout(state.bootTimer);
  if(extraWarm===state)extraWarm=null;
  finishWarmRequest(state,Error(reason));
  try{state.child.kill("SIGKILL");}catch{}
  // Fixed-class diagnostics only; never log product, SKU, URL or Python stderr.
  if(process.env.RENDER==="true"){
    console.info("NAWAA_EXTRA_WARM_RESET "+JSON.stringify({
      reason,stage:state.lastStage,completed:state.requests,
      uptimeMs:Math.round(performance.now()-state.started)
    }));
  }
  scheduleExtraWarmRestart(delayMs);
}
function acceptWarmReply(state,line){
  const p=state.pending;
  if(!p)return terminateExtraWarm(state,"PYTHON_EXTRA_UNSOLICITED_OUTPUT");
  let reply;
  try{reply=JSON.parse(line);}catch{
    return terminateExtraWarm(state,"PYTHON_EXTRA_JSON_INVALID");
  }
  if(!reply||reply.schemaVersion!==VERSION||reply.requestId!==p.requestId||
    reply.sourceId!=="extra-sa"||
    !["EVIDENCE_FOUND","INSUFFICIENT_EVIDENCE","ERROR"].includes(reply.status)){
    return terminateExtraWarm(state,"PYTHON_EXTRA_CONTRACT_INVALID");
  }
  state.outputBytes=0;
  if(reply.status==="ERROR"){
    const code=typeof reply.errorCode==="string"&&/^[A-Z0-9_]{3,80}$/.test(reply.errorCode)
      ? "PYTHON_EXTRA_SOURCE_"+reply.errorCode:"PYTHON_EXTRA_SOURCE_FAILURE";
    finishWarmRequest(state,Error(code));
    return;
  }
  if(!reply.evidence||typeof reply.evidence!=="object"||Array.isArray(reply.evidence))
    return terminateExtraWarm(state,"PYTHON_EXTRA_EVIDENCE_INVALID");
  finishWarmRequest(state,null,reply.evidence);
}
function startExtraPythonWarmWorker(){
  if(!extraWarmEnabled()||extraWarm||warmRestartTimer)return;
  const pythonBin=join(CWD,".venv/bin/python");
  if(!existsSync(pythonBin)){
    scheduleExtraWarmRestart(30000);
    return;
  }
  let child;
  try{
    child=spawn(pythonBin,["-m","nawaa_py.extra_pdp"],{
      cwd:CWD,stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true,
      env:{PATH:process.env.PATH??"",PYTHONPATH:CWD,
        PYTHONUNBUFFERED:"1",PYTHONDONTWRITEBYTECODE:"1"}
    });
  }catch{
    scheduleExtraWarmRestart(30000);
    return;
  }
  const state={child,started:performance.now(),ready:false,dead:false,
    pending:null,requests:0,lastStage:"spawn",outputBytes:0,stderrBytes:0,
    stdoutBuffer:"",stderrBuffer:"",bootTimer:null};
  extraWarm=state;
  state.bootTimer=setTimeout(()=>
    terminateExtraWarm(state,"PYTHON_EXTRA_BOOT_TIMEOUT",30000),25000);
  state.bootTimer.unref?.();
  child.stderr.on("data",chunk=>{
    if(state.dead)return;
    state.stderrBytes+=chunk.byteLength;
    if(state.stderrBytes>MAX_STDERR_BYTES*WARM_MAX_REQUESTS)
      return terminateExtraWarm(state,"PYTHON_EXTRA_STDERR_LIMIT");
    const lines=(state.stderrBuffer+chunk.toString("utf8")).split(/\r?\n/);
    state.stderrBuffer=lines.pop().slice(-256);
    for(const line of lines){
      const phase=parseExtraWorkerPhase(line);
      if(!phase)continue;
      state.lastStage=phase.stage;
      if(phase.stage==="worker_ready"&&!state.ready){
        state.ready=true;
        clearTimeout(state.bootTimer);
        if(process.env.RENDER==="true")
          console.info("NAWAA_EXTRA_WARM_READY "+JSON.stringify({
            startupMs:Math.round(performance.now()-state.started)
          }));
      }
    }
  });
  child.stdout.on("data",chunk=>{
    if(state.dead)return;
    state.outputBytes+=chunk.byteLength;
    if(state.outputBytes>MAX_STDOUT_BYTES)
      return terminateExtraWarm(state,"PYTHON_EXTRA_OUTPUT_LIMIT");
    const lines=(state.stdoutBuffer+chunk.toString("utf8")).split(/\r?\n/);
    state.stdoutBuffer=lines.pop();
    if(state.stdoutBuffer.length>MAX_STDOUT_BYTES)
      return terminateExtraWarm(state,"PYTHON_EXTRA_OUTPUT_LIMIT");
    for(const line of lines){
      if(line)acceptWarmReply(state,line);
      if(state.dead)return;
    }
  });
  child.stdin.on("error",()=>terminateExtraWarm(state,"PYTHON_EXTRA_STDIN_FAILURE"));
  child.on("error",()=>terminateExtraWarm(state,"PYTHON_EXTRA_SPAWN_FAILED"));
  child.on("close",()=>terminateExtraWarm(state,"PYTHON_EXTRA_WORKER_EXIT",
    state.requests>=WARM_MAX_REQUESTS?0:20000));
}
export function warmExtraPythonPdp(){
  if(extraWarmEnabled())startExtraPythonWarmWorker();
}
function runExtraWarmRequest(input,requestId,timeoutMs,signal){
  if(signal?.aborted)throw Error("PYTHON_EXTRA_ABORTED");
  const state=extraWarm;
  if(!state||!state.ready||state.dead||state.pending||
    state.requests>=WARM_MAX_REQUESTS)
    throw Error("PYTHON_EXTRA_BUSY");
  return new Promise((resolve,reject)=>{
    const pending={requestId,resolve,reject,signal,timer:null,abort:null};
    pending.abort=()=>terminateExtraWarm(state,"PYTHON_EXTRA_ABORTED",15000);
    state.pending=pending;
    state.requests++;
    pending.timer=setTimeout(()=>
      terminateExtraWarm(state,"PYTHON_EXTRA_TIMEOUT",15000),timeoutMs);
    signal?.addEventListener("abort",pending.abort,{once:true});
    try{
      state.child.stdin.write(input,error=>{
        if(error)terminateExtraWarm(state,"PYTHON_EXTRA_STDIN_FAILURE");
      });
    }catch{
      terminateExtraWarm(state,"PYTHON_EXTRA_STDIN_FAILURE");
    }
  });
}
