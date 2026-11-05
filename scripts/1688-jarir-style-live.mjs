#!/usr/bin/env node
// Staged 1688 trial of Jarir's first-party HTML / JSON-LD acquisition.
// Bounded, read-only, single-pass. Never enters production provider registry.
import {writeFile} from "node:fs/promises";
import {robotsDecision} from "../src/1688-public-discovery.mjs";
import {inspect1688SearchEvidence} from "../src/1688-html-evidence.mjs";

const ROOT="https://s.1688.com";
const UA="NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)";
const SEARCH=ROOT+"/selloffer/offer_search.htm?keywords=headphones";
const MAX=2_000_000, TIMEOUT=6500;
const report={schema:"nawaa.1688.jarir-html.v1",
  at:new Date().toISOString(),sha:process.env.GITHUB_SHA||null,
  mode:"jarir_first_party_html_jsonld",target:"1688-cn",
  live:true,noProxies:true,retries:0,
  customerPublished:false,priceVerified:0,inventoryVerified:0,
  searchesAttempted:0,robotsRequests:0,status:"NOT_RUN"};

async function get(url) {
  const start=performance.now();
  const r=await fetch(url,{
    method:"GET",redirect:"manual",signal:AbortSignal.timeout(TIMEOUT),
    headers:{accept:"text/html,application/xhtml+xml,text/plain;q=0.8",
      "user-agent":UA,"accept-language":"en-US,en;q=0.9"}
  });
  const result={status:r.status,contentType:r.headers.get("content-type")||"",
    location:r.headers.get("location")||null,elapsedMs:Math.round(performance.now()-start)};
  if(r.status!==200) {await r.body?.cancel().catch(()=>{});return {...result,body:""};}
  const pieces=[];let size=0;
  try {
    for await(const chunk of r.body||[]) {
      size+=chunk.byteLength;
      if(size>MAX) throw Error("RESPONSE_TOO_LARGE");
      pieces.push(Buffer.from(chunk));
    }
  } catch(e) {await r.body?.cancel().catch(()=>{});throw e;}
  return {...result,body:Buffer.concat(pieces).toString("utf8")};
}
function sanitizeRedirect(value,previous){
  try {
    const u=new URL(value,previous);
    if(u.protocol!=="https:"||u.username||u.password||
       !(u.hostname==="1688.com"||u.hostname.endsWith(".1688.com")) ||
       u.pathname!=="/robots.txt"||u.search||u.hash) return null;
    return u.href;
  }catch {return null;}
}
function classify(e){
  const s=String(e?.name||"")+" "+String(e?.message||"");
  return /timeout|abort/i.test(s)?"TIMEOUT":/TOO_LARGE/.test(s)?"SIZE_LIMIT":"TRANSPORT_FAILURE";
}

try {
  let u=ROOT+"/robots.txt",txt=null;
  for(let hop=0;hop<3;hop++){
    report.robotsRequests++;
    const r=await get(u);
    report.robots={http:r.status,host:new URL(u).hostname,
      hop,latencyMs:r.elapsedMs,
      redirectHost:(()=>{try{return new URL(r.location,u).hostname}catch{return null}})()};
    if(r.status===200 && /^text\/plain/i.test(r.contentType)){txt=r.body;break;}
    if(r.status>=300 && r.status<400) {
      const next=sanitizeRedirect(r.location,u);
      if(next && next!==u) {u=next;continue;}
      report.status="UNVERIFIED_ROBOTS_REDIRECT";
      break;
    }
    report.status="ROBOTS_UNAVAILABLE";
    break;
  }
  if(txt!==null) {
    const policy=robotsDecision(txt,SEARCH,"NAWAA-PublicSourceIndexer");
    report.robotsDecision=policy.reason;
    if(!policy.allowed) report.status="ROBOTS_DENIED_SEARCH";
    else {
      report.searchesAttempted++;
      const r=await get(SEARCH);
      report.searchHttp=r.status;report.searchLatencyMs=r.elapsedMs;
      report.searchRedirectHost=(()=>{try{return new URL(r.location,SEARCH).hostname}catch{return null}})();
      if(r.status===200){
        report.evidence=inspect1688SearchEvidence(r.body,{
          contentType:r.contentType,status:r.status,query:"headphones"});
        report.status=report.evidence.state;
      }else report.status=r.status===403?"HTTP_403":r.status===429?"HTTP_429":
        r.status>=300&&r.status<400?"SEARCH_REDIRECT":"HTTP_"+r.status;
    }
  }
}catch(e){report.status=classify(e);}
finally{
  await writeFile("1688-jarir-style-live.json",JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
