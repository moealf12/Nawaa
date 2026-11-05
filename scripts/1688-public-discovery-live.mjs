#!/usr/bin/env node
// Strictly live / non-publishing 1688 public discovery gate.
// One robots.txt GET, then up to eight serialized public search-page GETs.
// No auth spoofing, proxy, alternate headers, retries, cookies, or browser escalation.
import {writeFile} from "node:fs/promises";
import {robotsDecision,inspect1688Html} from "../src/1688-public-discovery.mjs";
const UA = "NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)";
const ROOT = "https://s.1688.com";
const QUERIES = [
  {id:"cn-phone",q:"手机壳"},
  {id:"cn-audio",q:"蓝牙耳机"},
  {id:"cn-computing",q:"笔记本电脑"},
  {id:"cn-home",q:"咖啡机"},
  {id:"cn-fashion",q:"运动鞋"},
  {id:"cn-toys",q:"儿童玩具"},
  {id:"en-audio",q:"headphones"},
  {id:"ar-audio",q:"سماعات بلوتوث"},
];
const REPORT = "1688-public-discovery-live.json";
const LIMIT = 1_048_576;
async function readLimited(res) {
  const length = Number(res.headers.get("content-length") || 0);
  if (length > LIMIT) throw new Error("BODY_TOO_LARGE");
  const chunks=[]; let bytes=0;
  if (!res.body) return "";
  for await (const data of res.body) {
    bytes += data.byteLength;
    if (bytes > LIMIT) throw new Error("BODY_TOO_LARGE");
    chunks.push(Buffer.from(data));
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function request(url, ms=6000) {
  const started=performance.now();
  // Fixed endpoint, query does not control host; no redirect follows.
  const res = await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(ms),headers:{
    accept:"text/html,application/xhtml+xml,text/plain;q=0.8",
    "user-agent":UA,
  }});
  const contentType=res.headers.get("content-type")||"";
  const body=res.status===200?await readLimited(res):"";
  if(res.status!==200) await res.body?.cancel().catch(()=>{});
  return {status:res.status,finalUrl:res.url||url,contentType,body,
    durationMs:Math.round(performance.now()-started)};
}
function errorClass(e) {
  const text=String(e?.message||e).toLowerCase();
  if (/timeout|timed out|aborted/.test(text)||e?.name==="TimeoutError") return "TIMEOUT";
  if(/BODY_TOO_LARGE/.test(text))return "BODY_TOO_LARGE";
  return "NETWORK_OR_TLS_ERROR";
}
const report = {
  schema:"nawaa.1688.public-discovery.v1",
  observedAt:new Date().toISOString(),
  githubSha:process.env.GITHUB_SHA||null,
  sourceId:"1688-cn", sourceUrl:ROOT,
  live:true, fixtureData:false, customerPublished:false,
  authorizedFeedTested:false, independentPdpPriceVerified:0,
  saudiDeliveryVerified:false, requestBudget:1+QUERIES.length,
  attempts:0, cases:[], robots:null, stopReason:null, conclusion:"NOT_RUN",
};
try {
  let robotText;
  try {
    const robots = await request(ROOT+"/robots.txt");
    report.attempts++;
    report.robots={status:robots.status,durationMs:robots.durationMs,
      bytes:Buffer.byteLength(robots.body)};
    if(robots.status!==200 || !robots.contentType.includes("text/plain")) {
      report.stopReason = "ROBOTS_UNAVAILABLE_OR_INVALID_CONTENT";
    } else {
      robotText=robots.body;
    }
  } catch(e) {
    report.attempts++;
    report.robots={status:null,errorClass:errorClass(e)};
    report.stopReason="ROBOTS_FETCH_FAILED";
  }
  if(robotText!==undefined) {
    for (const intent of QUERIES) {
      const searchUrl=ROOT+"/selloffer/offer_search.htm?keywords="+encodeURIComponent(intent.q);
      const policy=robotsDecision(robotText,searchUrl,"NAWAA-PublicSourceIndexer");
      if(!policy.allowed) {
        report.cases.push({id:intent.id,query:intent.q,state:"ROBOTS_DISALLOWED",rule:policy.rule||null});
        report.stopReason="ROBOTS_DISALLOWED";
        break;
      }
      try {
        const response=await request(searchUrl);
        report.attempts++;
        const evidence=inspect1688Html(response.body,{
          status:response.status,contentType:response.contentType,
          finalUrl:response.finalUrl,query:intent.q,
        });
        report.cases.push({id:intent.id,robots:policy.reason,
          durationMs:response.durationMs,...evidence});
        if(response.status===403 || response.status===429 || evidence.blockedReason ||
          response.status>=500 || response.status>=300) {
          report.stopReason=evidence.blockedReason || ("HTTP_"+response.status);
          break;
        }
      } catch(e) {
        report.attempts++;
        report.cases.push({id:intent.id,query:intent.q,state:"SOURCE_REQUEST_FAILED",
          failureClass:errorClass(e)});
        report.stopReason="SOURCE_REQUEST_FAILED";
        break;
      }
      // Gentle request pacing; never amplify 403/429.
      await new Promise(resolve=>setTimeout(resolve,850));
    }
  }
} catch(e) {
  report.stopReason="UNHANDLED_PROBE_ERROR";
  report.internalErrorClass=errorClass(e);
} finally {
  const withLinks=report.cases.filter(c=>c.state==="UNPRICED_PRODUCT_LINKS_OBSERVED").length;
  report.conclusion=report.stopReason||(
    withLinks>0?"LIVE_DISCOVERY_LINKS_ONLY_NOT_CERTIFIED":"LIVE_CATALOG_NOT_EVIDENCED");
  report.candidatePageCount=withLinks;
  // Never claim price/stock/shipping based on links or a 200 HTML shell.
  report.customerPublicationEligible=false;
  await writeFile(REPORT,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({
    conclusion:report.conclusion,robots:report.robots,attempts:report.attempts,
    discoveredPageCount:withLinks, priceVerified:0,
    cases:report.cases.map(c=>({
      id:c.id,state:c.state,status:c.status||null,
      blockedReason:c.blockedReason||null,candidateProductIdCount:c.candidateProductIdCount||0,
      durationMs:c.durationMs||null,
    })),
  },null,2));
}
