#!/usr/bin/env node
// Experimental read-only authorized Noon feed ingress. NOT a Noon official API
// client and never a customer-facing provider. Production routing is untouched.
// An admin-provided feed URL and an exact host allowlist are mandatory.
import {writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {inspectNoonApprovedFeedPage} from "../src/noon-sa-approved-feed.mjs";

const MAX_PAGES=4;
const MAX_BYTES=8_000_000;
const TIMEOUT_MS=15_000;
const REPORT="noon-sa-approved-feed-live.json";
const FEED_URL=process.env.NOON_APPROVED_FEED_URL||"";
const FEED_HOST=process.env.NOON_APPROVED_FEED_HOST||"";
const AUTH_TOKEN=process.env.NOON_APPROVED_FEED_TOKEN||"";
const report={
  schema:"nawaa.noon-sa.approved-feed-acceptance.v1",
  headSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  observedAt:new Date().toISOString(),
  firstPartyNoonSource:false, // Merchant origin not independently proven by URL alone.
  source:"noon-sa",
  merchantPermission:"REPORTED_BY_PROJECT_OWNER",
  transport:"configured_merchant_approved_https_feed",
  liveOnly:true,proxies:false,retries:0,pages:[],
  customerPublished:false,merchantsMarketScopeVerified:false,
  pdpPriceVerified:false,checkoutVerified:false,deliveryVerified:false,
  finalState:"NOT_RUN",
};
const safeEndpoint=(input,basePath)=>{
  try{
    const u=new URL(input);
    if(u.protocol!=="https:"||u.username||u.password||u.hash||
       u.port||u.hostname.toLowerCase()!==FEED_HOST.toLowerCase()||
       !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(u.hostname))return null;
    if(basePath&&u.pathname!==basePath)return null; // cursor query only
    return u;
  }catch{return null}
};
function classify(error){
  if(error?.name==="TimeoutError"||error?.name==="AbortError")return "TIMEOUT";
  const code=String(error?.cause?.code||error?.code||"");
  if(["ENOTFOUND","EAI_AGAIN"].includes(code))return "DNS_FAILURE";
  if(["ECONNRESET","ECONNREFUSED","ETIMEDOUT"].includes(code))return "NETWORK_"+code;
  if(error?.message==="BODY_TOO_LARGE")return "BODY_TOO_LARGE";
  return "FETCH_FAILED";
}
async function getPage(url){
  const headers={accept:"application/json",
    "user-agent":"NAWAA-ApprovedFeedReader/1.0"};
  if(AUTH_TOKEN)headers.authorization="Bearer "+AUTH_TOKEN;
  const response=await fetch(url,{
    method:"GET",redirect:"error",headers,
    signal:AbortSignal.timeout(TIMEOUT_MS),
  });
  if(!response.ok)return {state:"HTTP_"+response.status,payload:null,sha256:null};
  const ct=response.headers.get("content-type")||"";
  if(!/(?:application\/json|\+json)/i.test(ct))
    return {state:"CONTENT_TYPE_NOT_JSON",payload:null,sha256:null};
  const declared=response.headers.get("content-length");
  if(declared!==null&&Number.isFinite(Number(declared))&&
    Number(declared)>MAX_BYTES)
    return {state:"BODY_TOO_LARGE",payload:null,sha256:null};
  const reader=response.body?.getReader();
  if(!reader)return {state:"NO_RESPONSE_BODY",payload:null,sha256:null};
  let size=0;const chunks=[];
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES)throw new Error("BODY_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  }finally{
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
  const raw=Buffer.concat(chunks);
  let payload;
  try{payload=JSON.parse(raw.toString("utf8"))}
  catch{return {state:"INVALID_JSON",payload:null,sha256:null}}
  return {state:"JSON_RECEIVED",payload,
    sha256:createHash("sha256").update(raw).digest("hex")};
}

try{
  const initial=safeEndpoint(FEED_URL);
  if(!initial||!FEED_HOST){
    report.finalState="APPROVED_FEED_ENDPOINT_NOT_CONFIGURED";
  }else{
    const path=initial.pathname;
    const visited=new Set(),entries=new Map();
    let next=initial.href;
    let invalidRecords=0,conflicts=0;
    let resultState=null;
    for(let i=0;i<MAX_PAGES&&next;i++){
      if(visited.has(next)){resultState="PAGINATION_CYCLE";break}
      visited.add(next);
      const step={pageNumber:i+1};
      const started=performance.now();
      try{
        const received=await getPage(next);
        step.transportState=received.state;
        step.bodySha256=received.sha256;
        if(received.state!=="JSON_RECEIVED"){
          resultState=received.state;break;
        }
        const inspection=inspectNoonApprovedFeedPage(received.payload);
        step.validationState=inspection.state;
        step.accepted=inspection.accepted;
        step.rejected=inspection.rejected;
        step.conflicts=inspection.conflicts;
        step.freshOffers=inspection.freshOffers;
        invalidRecords+=inspection.rejected;
        conflicts+=inspection.conflicts;
        if(inspection.state!=="APPROVED_FEED_PAGE_VALIDATED_DIAGNOSTIC_ONLY"){
          resultState=inspection.state;break;
        }
        for(const offer of inspection.records){
          if(entries.get(offer.key)===null)continue;
          const prior=entries.get(offer.key);
          if(prior&&(prior.price!==offer.price||prior.title!==offer.title)){
            entries.set(offer.key,null);
            conflicts++;
          }else if(!prior||prior.observedMs<offer.observedMs){
            entries.set(offer.key,offer);
          }
        }
        const pagination=received.payload.next_page;
        if(pagination===undefined||pagination===null||pagination===""){
          next=null;resultState="FEED_DATA_OBSERVED_DIAGNOSTIC_ONLY";
        }else{
          const continuation=safeEndpoint(pagination,path);
          if(!continuation){
            resultState="INVALID_PAGINATION_URL";break;
          }
          next=continuation.href;
          if(i===MAX_PAGES-1)resultState="PAGINATION_PAGE_LIMIT_REACHED";
        }
      }catch(error){
        resultState=classify(error);
        step.transportState=resultState;
        break;
      }finally{
        step.elapsedMs=Math.round(performance.now()-started);
        report.pages.push(step);
      }
    }
    report.offersAcceptedDiagnostic=[...entries.values()].filter(Boolean).length;
    report.invalidRecords=invalidRecords;
    report.conflictingOffers=conflicts;
    report.finalState=resultState||"UNKNOWN";
    report.customerPublished=false;
  }
}catch{
  report.finalState="UNEXPECTED_VALIDATION_FAILURE";
}finally{
  await writeFile(REPORT,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if(report.finalState!=="FEED_DATA_OBSERVED_DIAGNOSTIC_ONLY"||
     !(report.offersAcceptedDiagnostic>0))process.exitCode=1;
}
