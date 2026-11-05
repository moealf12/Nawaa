// Production Node -> existing local Python runtime, Noon UAE only.
// One child at a time, fixed merchant/query contract, no shell, no hidden
// network retries, no cross-source effects. Only bounded JSON card evidence
// crosses the process boundary; full source HTML stays in the worker.
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {StringDecoder} from "node:string_decoder";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";

const ROOT=fileURLToPath(new URL("../workers/python-intelligence/",import.meta.url));
const BIN=join(ROOT,".venv/bin/python");
const SCHEMA="nawaa.noon.ae.cards.v1";
const MAX_OUTPUT=512_000;
const MAX_BUDGET=5600;
let active=0;
const MAX_ACTIVE=1;

export function noonUaePythonEnabled(env=process.env){
  return env.NAWAA_NOON_AE_PYTHON==="1";
}

function classifiedError(code){
  const known=new Set(["HTTP_403_ACCESS_DENIED","HTTP_429_RATE_LIMITED",
    "SOURCE_HTTP_TIMEOUT","SOURCE_TRANSPORT_FAILURE","SOURCE_HTTP_FAILURE",
    "SOURCE_WARMUP_UNAVAILABLE","SOURCE_SEARCH_URL_MISMATCH",
    "SOURCE_HTML_UNAVAILABLE","RESPONSE_TOO_LARGE","NON_HTML_RESPONSE"]);
  const name=known.has(code)?code:"NOON_AE_PYTHON_FAILURE";
  const error=new Error(name);
  if(name==="HTTP_403_ACCESS_DENIED"||name==="HTTP_429_RATE_LIMITED")
    error.failureClass=name;
  if(name==="SOURCE_HTTP_TIMEOUT")error.failureClass="HTTP_TIMEOUT";
  if(name==="SOURCE_SEARCH_URL_MISMATCH")error.failureClass="HTTP_REDIRECT_CHANGED";
  return error;
}

export async function fetchNoonUaePythonCards(query,{
  signal,budgetMs=5300,pythonBin=BIN,spawnImpl=spawn,
}={}){
  if(typeof query!=="string"||query.length<2||query.length>120||
     /[\x00-\x1f\x7f]/.test(query))
    throw Error("NOON_AE_QUERY_INVALID");
  if(!Number.isInteger(budgetMs)||budgetMs<1500||budgetMs>MAX_BUDGET)
    throw Error("NOON_AE_BUDGET_INVALID");
  if(signal?.aborted)throw signal.reason||Error("NOON_AE_ABORTED");
  if(active>=MAX_ACTIVE)throw Error("NOON_AE_PYTHON_BUSY");
  if(typeof pythonBin!=="string"||
     !/^(?:python3(?:\.\d+)?|\/[A-Za-z0-9_./-]+)$/.test(pythonBin)||
     (pythonBin===BIN&&!existsSync(BIN)))
    throw Error("NOON_AE_PYTHON_RUNTIME_UNAVAILABLE");
  const requestId=randomUUID();
  const packet={schemaVersion:SCHEMA,requestId,sourceId:"noon-ae",
    query,budgetMs:Math.min(budgetMs-350,MAX_BUDGET)};
  if(Buffer.byteLength(JSON.stringify(packet))>1300)
    throw Error("NOON_AE_INPUT_LIMIT");
  active++;
  return new Promise((resolve,reject)=>{
    let child;
    let done=false,buffer="",size=0;
    const utf8=new StringDecoder("utf8");
    let timer=null;
    const finalize=(error,value)=>{
      if(done)return;
      done=true;
      active--;
      clearTimeout(timer);
      signal?.removeEventListener("abort",abort);
      if(error){
        try{child?.kill("SIGKILL");}catch{}
        reject(error);
      }else resolve(value);
    };
    const abort=()=>finalize(signal?.reason||Error("NOON_AE_ABORTED"));
    try{
      child=spawnImpl(pythonBin,["-m","nawaa_py.noon_ae_search"],{
        cwd:ROOT,stdio:["pipe","pipe","pipe"],shell:false,windowsHide:true,
        env:{PATH:process.env.PATH||"",PYTHONPATH:ROOT,
          PYTHONDONTWRITEBYTECODE:"1",PYTHONUNBUFFERED:"1"},
      });
    }catch{return finalize(Error("NOON_AE_PYTHON_SPAWN_FAILED"));}
    signal?.addEventListener("abort",abort,{once:true});
    timer=setTimeout(()=>finalize(classifiedError("SOURCE_HTTP_TIMEOUT")),budgetMs);
    child.on("error",()=>finalize(Error("NOON_AE_PYTHON_SPAWN_FAILED")));
    child.stdin.on("error",()=>finalize(Error("NOON_AE_PYTHON_STDIN_FAILED")));
    child.stderr.on("data",()=>{}); // suppress merchant pages/headers and cookies
    child.stdout.on("data",part=>{
      size+=part.byteLength;
      if(size>MAX_OUTPUT)
        return finalize(Error("NOON_AE_PYTHON_OUTPUT_LIMIT"));
      buffer+=utf8.write(part);
    });
    child.on("close",code=>{
      if(done)return;
      if(code!==0)return finalize(Error("NOON_AE_PYTHON_EXIT_NONZERO"));
      buffer+=utf8.end();
      const lines=buffer.trimEnd().split(/\r?\n/);
      if(lines.length!==1)return finalize(Error("NOON_AE_PYTHON_JSONL_INVALID"));
      let result;
      try{result=JSON.parse(lines[0]);}
      catch{return finalize(Error("NOON_AE_PYTHON_JSON_INVALID"));}
      if(!result||result.schemaVersion!==SCHEMA||
         result.requestId!==requestId||result.sourceId!=="noon-ae"||
         !["OK","ERROR"].includes(result.status))
        return finalize(Error("NOON_AE_PYTHON_CONTRACT_INVALID"));
      if(result.status==="ERROR")
        return finalize(classifiedError(result.errorCode));
      if(typeof result.finalUrl!=="string"||
         !["en-AE","ar-AE"].includes(result.language)||
         typeof result.heading!=="string"||result.heading.length>350||
         !Array.isArray(result.cards)||result.cards.length>250||
         result.cards.some(card=>!card||typeof card!=="object"||Array.isArray(card)||
           typeof card.productId!=="string"||typeof card.offerCode!=="string"||
           typeof card.sourceUrl!=="string"||card.sourceUrl.length>2500||
           typeof card.title!=="string"||card.title.length>350||
           typeof card.priceText!=="string"||card.priceText.length>100||
           !Number.isFinite(card.priceAED)||card.currency!=="AED"||
           typeof card.image!=="string"||card.image.length>2500))
        return finalize(Error("NOON_AE_PYTHON_RESULT_INVALID"));
      let actual;
      try{actual=new URL(result.finalUrl);}
      catch{return finalize(Error("NOON_AE_PYTHON_FINAL_URL_INVALID"));}
      const expected=new URL("https://www.noon.com/uae-en/search/?q="+encodeURIComponent(query));
      if(actual.protocol!=="https:"||actual.host!==expected.host||
         actual.pathname.replace(/\/+$/,"")!==expected.pathname.replace(/\/+$/,"")||
         actual.hash||actual.searchParams.size!==1||
         actual.searchParams.getAll("q").length!==1||
         actual.searchParams.get("q")!==query)
        return finalize(classifiedError("SOURCE_SEARCH_URL_MISMATCH"));
      finalize(null,{finalUrl:result.finalUrl,
        language:result.language,heading:result.heading,cards:result.cards,
        transport:"PYTHON_NOON_AE_JSON"});
    });
    try{child.stdin.end(JSON.stringify(packet)+"\n");}
    catch{return finalize(Error("NOON_AE_PYTHON_STDIN_FAILED"));}
  });
}
