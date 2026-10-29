// eXtra Python product evidence transport, bounded and explicitly source-owned.
// Standalone URL + product SKU only. No arbitrary source URLs, shell, or trust grants.
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {StringDecoder} from "node:string_decoder";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const CWD=fileURLToPath(new URL("../workers/python-intelligence/",import.meta.url));
const VERSION="nawaa.extra.pdp.v1";
const MAX_STDOUT_BYTES=128_000,MAX_STDERR_BYTES=8_192;
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
      u.pathname===\`/en-sa/p/\${sku}\`&&u.href===rawUrl;
  }catch{return false;}
}

export async function runExtraPythonPdp({url,expectedSku},{
  timeoutMs=3000,signal,
  pythonBin=process.env.RENDER==="true" ? join(CWD,".venv/bin/python") : "python3"
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

  return new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawn(pythonBin,["-m","nawaa_py.extra_pdp"],{
        cwd:CWD,stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true,
        env:{PATH:process.env.PATH??"",PYTHONPATH:CWD,
             PYTHONUNBUFFERED:"1",PYTHONDONTWRITEBYTECODE:"1"}
      });
    }catch{
      reject(Error("PYTHON_EXTRA_SPAWN_FAILED"));return;
    }
    let finished=false,stdout="",bytes=0,errBytes=0;
    const decoder=new StringDecoder("utf8");
    let timer;
    const finish=(error,value)=>{
      if(finished)return;
      finished=true;
      clearTimeout(timer);
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
      if(errBytes>MAX_STDERR_BYTES)finish(Error("PYTHON_EXTRA_STDERR_LIMIT"));
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
