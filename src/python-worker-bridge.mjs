// NAWAA Python evidence bridge. Disabled in shopper paths until explicitly gated.
// No shell, shared database, trust promotion, or user-controlled executable path.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const WORKDIR=fileURLToPath(new URL("../workers/python-intelligence/",import.meta.url));
const VERSION="nawaa.python.extract.v1";
const MAX_INPUT_BYTES=2_200_000;
const MAX_OUTPUT_BYTES=256_000;
const MAX_STDERR_BYTES=16_000;
const REQUEST_ID=/^[A-Za-z0-9._:-]{1,128}$/;
const SOURCE_ID=/^[a-z0-9][a-z0-9-]{1,79}$/;

export async function runPythonExtraction(payload,{
  timeoutMs=10000,signal,allowNetwork=false,pythonBin="python3"
}={}){
  if(!payload||typeof payload!=="object"||payload.schemaVersion!==VERSION||
    !REQUEST_ID.test(payload.requestId)||!SOURCE_ID.test(payload.sourceId))
    throw Error("PYTHON_INPUT_CONTRACT_INVALID");
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
    throw Error("PYTHON_TIMEOUT_INVALID");
  if(typeof pythonBin!=="string"||!/^(?:python3(?:\.\d+)?|\/[A-Za-z0-9_./-]+)$/.test(pythonBin))
    throw Error("PYTHON_EXECUTABLE_NOT_APPROVED");
  let encoded;
  try{encoded=JSON.stringify(payload)+"\n";}
  catch{throw Error("PYTHON_INPUT_NOT_JSON");}
  if(Buffer.byteLength(encoded,"utf8")>MAX_INPUT_BYTES)
    throw Error("PYTHON_INPUT_TOO_LARGE");
  if(signal?.aborted)throw Error("PYTHON_ABORTED");
  return new Promise((resolveResult,rejectResult)=>{
    let child;
    try{
      child=spawn(pythonBin,["-m","nawaa_py.cli"],{
        cwd:WORKDIR,stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true,
        env:{
          PATH:process.env.PATH??"",
          PYTHONPATH:WORKDIR,
          PYTHONUNBUFFERED:"1",
          NAWAA_PY_LIVE_ENABLED:allowNetwork?"1":"0"
        }
      });
    }catch{rejectResult(Error("PYTHON_SPAWN_FAILED"));return;}
    let done=false,stdout="",stderrBytes=0,stdoutBytes=0;
    let timer;
    const abort=()=>finish(Error("PYTHON_ABORTED"));
    const finish=(error,value)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      signal?.removeEventListener("abort",abort);
      if(error){
        if(!child.killed)child.kill("SIGKILL");
        rejectResult(error);
      }else resolveResult(value);
    };
    timer=setTimeout(()=>finish(Error("PYTHON_WORKER_TIMEOUT")),timeoutMs);
    signal?.addEventListener("abort",abort,{once:true});
    child.on("error",()=>finish(Error("PYTHON_SPAWN_FAILED")));
    child.stdout.on("data",chunk=>{
      stdoutBytes+=chunk.length;
      if(stdoutBytes>MAX_OUTPUT_BYTES){finish(Error("PYTHON_OUTPUT_TOO_LARGE"));return;}
      stdout+=chunk.toString("utf8");
    });
    child.stderr.on("data",chunk=>{
      stderrBytes+=chunk.length;
      if(stderrBytes>MAX_STDERR_BYTES)finish(Error("PYTHON_STDERR_TOO_LARGE"));
    });
    child.stdin.on("error",()=>finish(Error("PYTHON_STDIN_FAILED")));
    child.on("close",code=>{
      if(done)return;
      if(code!==0){finish(Error("PYTHON_WORKER_EXIT_NONZERO"));return;}
      const lines=stdout.split(/\r?\n/).filter(x=>x.length>0);
      if(lines.length!==1){finish(Error("PYTHON_JSONL_FRAMING_INVALID"));return;}
      let result;
      try{result=JSON.parse(lines[0]);}
      catch{finish(Error("PYTHON_RESPONSE_INVALID_JSON"));return;}
      if(!result||typeof result!=="object"||
        result.schemaVersion!==VERSION||
        result.requestId!==payload.requestId||result.sourceId!==payload.sourceId||
        !["CLASSIFIED","EXTRACTED","NO_OFFER","ERROR"].includes(result.status)){
        finish(Error("PYTHON_RESPONSE_CONTRACT_INVALID"));return;
      }
      if(result.status==="ERROR"){
        if(typeof result.errorCode!=="string"||!/^[A-Z0-9_]{2,80}$/.test(result.errorCode)||
          "offerEvidence" in result){
          finish(Error("PYTHON_ERROR_CONTRACT_INVALID"));return;
        }
      }else{
        if(!result.identity||!["REJECT","INSUFFICIENT_EVIDENCE","CANDIDATE"].includes(result.identity.decision)||
          !Array.isArray(result.identity.conflicts)||!Array.isArray(result.identity.missing)||
          (result.offerEvidence!==null&&result.offerEvidence!==undefined&&
            (!/^\d+(?:\.\d{1,2})?$/.test(String(result.offerEvidence.price))||
              !/^[A-Z]{3}$/.test(result.offerEvidence.currency)))){
          finish(Error("PYTHON_EVIDENCE_CONTRACT_INVALID"));return;
        }
      }
      finish(null,result);
    });
    child.stdin.end(encoded);
  });
}

export const PYTHON_WORKER_CONTRACT=VERSION;
