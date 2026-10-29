// Feature-gated Jarir-only JSON Lines subprocess; no shell or general URL fetching.
// Never use its raw observation as a trust grant. The Node adapter revalidates it.
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {StringDecoder} from "node:string_decoder";
import {fileURLToPath} from "node:url";

const CWD=fileURLToPath(new URL("../workers/python-intelligence/",import.meta.url));
const VERSION="nawaa.jarir.pdp.v1";
const MAX_OUT=96_000,MAX_ERR=8_192;
const SUFFIX=/^\/sa-en\/[a-z0-9-]+-(\d{5,8})\.html$/;

export function approvedJarirPdp(rawUrl,sku){
  try{
    if(typeof rawUrl!=="string"||typeof sku!=="string"||!/^\d{5,8}$/.test(sku))return false;
    const url=new URL(rawUrl);
    const match=url.pathname.match(SUFFIX);
    return url.protocol==="https:"&&url.hostname==="www.jarir.com"&&
      !url.username&&!url.password&&!url.search&&!url.hash&&
      (url.port===""||url.port==="443")&&match?.[1]===sku&&url.href===rawUrl;
  }catch{return false;}
}

export async function runJarirPythonPdp({url,expectedSku},{
  timeoutMs=5500,signal,pythonBin="python3"
}={}){
  if(!approvedJarirPdp(url,expectedSku))throw Error("PYTHON_JARIR_URL_SKU_REJECTED");
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>12000)
    throw Error("PYTHON_JARIR_TIMEOUT_INVALID");
  if(typeof pythonBin!=="string"||!/^(?:python3(?:\.\d+)?|\/[A-Za-z0-9_./-]+)$/.test(pythonBin))
    throw Error("PYTHON_JARIR_EXECUTABLE_INVALID");
  if(signal?.aborted)throw Error("PYTHON_JARIR_ABORTED");
  const requestId=randomUUID();
  const encoded=JSON.stringify({schemaVersion:VERSION,requestId,
    url,expected_sku:expectedSku})+"\n";
  if(Buffer.byteLength(encoded)>4096)throw Error("PYTHON_JARIR_INPUT_TOO_LARGE");
  return new Promise((resolve,reject)=>{
    let child;
    try{
      child=spawn(pythonBin,["-m","nawaa_py.jarir_pdp"],{
        cwd:CWD,shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"],
        env:{
          PATH:process.env.PATH??"",
          PYTHONPATH:CWD,
          PYTHONUNBUFFERED:"1",
          PYTHONDONTWRITEBYTECODE:"1"
        }
      });
    }catch{reject(Error("PYTHON_JARIR_SPAWN_FAILED"));return;}
    let done=false,stdout="",outputBytes=0,errorBytes=0;
    const decoder=new StringDecoder("utf8");
    let timer;
    const finish=(error,value)=>{
      if(done)return;done=true;
      clearTimeout(timer);
      signal?.removeEventListener("abort",onAbort);
      if(error){if(!child.killed)child.kill("SIGKILL");reject(error);}
      else resolve(value);
    };
    const onAbort=()=>finish(Error("PYTHON_JARIR_ABORTED"));
    signal?.addEventListener("abort",onAbort,{once:true});
    timer=setTimeout(()=>finish(Error("PYTHON_JARIR_TIMEOUT")),timeoutMs);
    child.on("error",()=>finish(Error("PYTHON_JARIR_SPAWN_FAILED")));
    child.stdout.on("data",chunk=>{
      outputBytes+=chunk.byteLength;
      if(outputBytes>MAX_OUT)return finish(Error("PYTHON_JARIR_OUTPUT_LIMIT"));
      stdout+=decoder.write(chunk);
    });
    child.stderr.on("data",chunk=>{
      errorBytes+=chunk.byteLength;
      if(errorBytes>MAX_ERR)finish(Error("PYTHON_JARIR_STDERR_LIMIT"));
    });
    child.stdin.on("error",()=>finish(Error("PYTHON_JARIR_STDIN_FAILED")));
    child.on("close",code=>{
      if(done)return;
      stdout+=decoder.end();
      if(code!==0)return finish(Error("PYTHON_JARIR_EXIT_NONZERO"));
      const lines=stdout.split(/\r?\n/).filter(Boolean);
      if(lines.length!==1)return finish(Error("PYTHON_JARIR_JSONL_FRAMING_INVALID"));
      let reply;
      try{reply=JSON.parse(lines[0]);}
      catch{return finish(Error("PYTHON_JARIR_INVALID_JSON"));}
      if(!reply||reply.schemaVersion!==VERSION||
        reply.requestId!==requestId||reply.status!=="SUCCESS"||
        !reply.evidence||typeof reply.evidence!=="object"||
        Array.isArray(reply.evidence))
        return finish(Error("PYTHON_JARIR_RESPONSE_INVALID"));
      finish(null,reply.evidence);
    });
    child.stdin.end(encoded);
  });
}
