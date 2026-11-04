#!/usr/bin/env node
// Stage-only live acquisition of an EXISTING Noon-approved partner catalog export.
// Supports CSV/TSV/JSON with local field mapping, no new Noon server contract.
// NOT a public proxy, customer provider, or authenticated partner API assumption.
import {createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {inspectNoonExistingExport} from "../src/noon-sa-existing-export.mjs";

const urlRaw=process.env.NOON_EXISTING_EXPORT_URL||"";
const pinnedHost=process.env.NOON_EXISTING_EXPORT_HOST||"";
const secret=process.env.NOON_EXISTING_EXPORT_TOKEN||"";
const format=process.env.NOON_EXISTING_EXPORT_FORMAT||"csv";
const MAX_BYTES=8_000_000;
const REPORT="noon-sa-existing-export-live.json";
const output={
  schema:"nawaa.noon-sa.existing-export-acceptance.v1",
  observedAt:new Date().toISOString(),
  exactHeadSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  source:"noon-sa",
  transport:"merchant_approved_existing_catalog_export",
  customerPublished:false,priceFreshnessVerified:false,
  scopeIndependentlyVerified:false,
  liveOnly:true,noProxies:true,retries:0,
  state:"NOT_RUN",
};

function configuredUrl(raw,host){
  if(!host||typeof host!=="string"||host.length>253||
     !/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(host))return null;
  if(!raw||raw.length>2048)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.hostname.toLowerCase()!==host.toLowerCase()||
       url.port||url.username||url.password||url.hash)return null;
    return url;
  }catch{return null}
}
function safeError(error){
  if(error?.name==="AbortError"||error?.name==="TimeoutError")return "TIMEOUT";
  if(error?.message==="RESPONSE_TOO_LARGE")return "RESPONSE_TOO_LARGE";
  const code=String(error?.cause?.code||error?.code||"");
  if(["ENOTFOUND","EAI_AGAIN"].includes(code))return "DNS_FAILURE";
  if(["ECONNRESET","ECONNREFUSED","ETIMEDOUT"].includes(code))return "NETWORK_ERROR";
  return "FETCH_FAILED";
}
async function readLimited(response){
  const declared=response.headers.get("content-length");
  if(declared!==null&&Number.isFinite(Number(declared))&&Number(declared)>MAX_BYTES)
    throw new Error("RESPONSE_TOO_LARGE");
  if(!response.body)throw new Error("EMPTY_RESPONSE");
  const reader=response.body.getReader();
  const chunks=[];let bytes=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES)throw new Error("RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
try{
  const url=configuredUrl(urlRaw,pinnedHost);
  if(!url){
    output.state="EXISTING_EXPORT_NOT_CONFIGURED";
  }else if(!["csv","tsv","json"].includes(format)){
    output.state="INVALID_EXPORT_FORMAT";
  }else{
    let columns=null;
    try{
      columns=process.env.NOON_EXISTING_EXPORT_COLUMNS?
        JSON.parse(process.env.NOON_EXISTING_EXPORT_COLUMNS):null;
    }catch{output.state="INVALID_COLUMN_MAP"}
    if(output.state==="NOT_RUN"){
      const t=performance.now();
      try{
        const headers={accept:format==="json"?"application/json":
          "text/csv,text/tab-separated-values,application/octet-stream",
          "user-agent":"NAWAA-PartnerExportImporter/1.0"};
        if(secret)headers.authorization="Bearer "+secret;
        const response=await fetch(url,{
          method:"GET",headers,redirect:"error",
          signal:AbortSignal.timeout(15000),
        });
        output.httpStatus=response.status;
        if(!response.ok){
          output.state=response.status===401?"AUTH_REQUIRED":
            response.status===403?"ACCESS_DENIED":"EXPORT_HTTP_"+response.status;
        }else{
          const ct=(response.headers.get("content-type")||"").toLowerCase();
          const expected=format==="json"?/(?:application\/json|\+json)/:
            /(?:text\/csv|application\/csv|text\/tab-separated-values|application\/octet-stream|text\/plain)/;
          if(!expected.test(ct))output.state="UNEXPECTED_CONTENT_TYPE";
          else{
            const raw=await readLimited(response);
            output.responseBytes=raw.length;
            output.bodySha256=createHash("sha256").update(raw).digest("hex");
            const parsed=inspectNoonExistingExport(raw.toString("utf8"),{
              format,columnMap:columns,
            });
            output.state=parsed.state;
            output.accepted=parsed.accepted;
            output.rejected=parsed.rejected;
            output.conflicts=parsed.conflicts||0;
            output.priceObservationsUnverified=parsed.sourcePriceObservations||0;
            output.identityOnly=parsed.identityOnly||0;
            output.rejectionClasses=parsed.rejections||null;
            // No raw export, product titles, item links, credentials or token logged.
          }
        }
      }catch(error){output.state=safeError(error)}
      finally{output.elapsedMs=Math.round(performance.now()-t)}
    }
  }
}catch{output.state="INVALID_CONFIGURATION"}
finally{
  await writeFile(REPORT,JSON.stringify(output,null,2)+"\n");
  console.log(JSON.stringify(output,null,2));
  if(output.state!=="EXISTING_EXPORT_PARSED_DIAGNOSTIC_ONLY"||
    !(output.accepted>0))process.exitCode=1;
}
