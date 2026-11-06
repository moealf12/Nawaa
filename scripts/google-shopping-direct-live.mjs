#!/usr/bin/env node
// Isolated LIVE Google Shopping direct-acquisition audit, zero cost.
// Jarir-style HTTP/JSON-LD and Noon-UAE-style HTML hydration are examined
// ONLY on publicly robot-admitted URLs. Forbidden Shopping queries are NEVER fetched.
import {writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {load} from "cheerio";
import {
  googleShoppingDirectCandidates,googleRobotsAdmission,
  evaluateGoogleShoppingDirectPaths,GOOGLE_ALLOWED_NON_SEARCH_LANDING,
} from "../src/google-shopping-direct-policy.mjs";

const USER_AGENT="NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)";
const REPORT_FILE="google-shopping-direct-live.json";
const MAX_ROBOTS=350_000;
const MAX_HTML=700_000;
let actualRequests=0,searchRequests=0;
const report={
  schema:"nawaa.google-shopping.direct-evidence.v1",
  timestampUtc:new Date().toISOString(),
  exactHeadSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  live:true,freeOfPaidApis:true,noProxies:true,
  userAgent:USER_AGENT,googleRobotsStatus:null,
  robotTextSha256:null,
  queriedIntents:[],
  directQueriesFetched:0,
  totalGoogleNetworkRequests:0,
  eligibleQueryAcquisition:false,
  observedProductCards:0,publishableOffers:0,verifiedPrices:0,
  state:"NOT_STARTED",
};

async function getBounded(url,maxBytes) {
  const parsed=new URL(url);
  if(parsed.origin!=="https://www.google.com"||parsed.username||parsed.password)
    throw Error("NON_GOOGLE_HOST");
  actualRequests++;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const res=await fetch(url,{
      redirect:"manual",
      signal:controller.signal,
      headers:{"user-agent":USER_AGENT,accept:"text/plain,text/html;q=0.9"},
    });
    const bytes=[];let length=0;
    if(res.status!==200)return {
      status:res.status,contentType:res.headers.get("content-type")||"",
      redirectPresent:Boolean(res.headers.get("location")),text:""};
    const advertised=Number(res.headers.get("content-length"));
    if(Number.isFinite(advertised)&&advertised>maxBytes)throw Error("CONTENT_TOO_LARGE");
    for await(const part of res.body||[]){
      length+=part.byteLength;
      if(length>maxBytes)throw Error("CONTENT_TOO_LARGE");
      bytes.push(Buffer.from(part));
    }
    return {
      status:res.status,contentType:res.headers.get("content-type")||"",
      redirectPresent:false,
      text:Buffer.concat(bytes).toString("utf8"),
    };
  }finally{clearTimeout(timeout);}
}

try{
  const robots=await getBounded("https://www.google.com/robots.txt",MAX_ROBOTS);
  report.googleRobotsStatus=robots.status;
  if(robots.status!==200||!robots.contentType.toLowerCase().includes("text/plain")||
     !robots.text.includes("User-agent:")||!robots.text.includes("Disallow:")){
    report.state="ROBOTS_NOT_ATTESTED";
    process.exitCode=1;
  }else {
    report.robotTextSha256=createHash("sha256").update(robots.text).digest("hex");
    for(const queryId of [
      {id:"en_iphone",q:"iPhone 17 256GB"},
      {id:"ar_audio",q:"سماعات بلوتوث"},
      {id:"mixed_gaming",q:"PS5 ديجيتال"},
    ]){
      const checked=evaluateGoogleShoppingDirectPaths(robots.text,queryId.q);
      report.queriedIntents.push({
        id:queryId.id,
        state:checked.status,allowedSearchPaths:checked.allowedSearchPaths,
        routes:checked.paths.map(x=>({
          kind:x.kind,allowed:x.admission.allowed,
          rule:x.admission.matchedRule,
          reason:x.admission.reason,
        })),
      });
      // DO NOT send any queries or collect price data when robots denies.
      if(checked.allowedSearchPaths>0){
        report.eligibleQueryAcquisition=true;
      }
    }
    const landing=googleRobotsAdmission(robots.text,GOOGLE_ALLOWED_NON_SEARCH_LANDING);
    report.exactNonQueryLanding={robotsAllowed:landing.allowed,rule:landing.matchedRule};
    if(landing.allowed){
      // Unlike Google Shopping search, this one exact non-query path is
      // robot-admitted as of the observed robots snapshot. One bounded HTTP
      // request without cookies, browser impersonation or redirects.
      const response=await getBounded(GOOGLE_ALLOWED_NON_SEARCH_LANDING,MAX_HTML);
      const evidence={
        httpStatus:response.status,
        redirectPresent:response.redirectPresent,
        htmlBytes:Buffer.byteLength(response.text),
        admittedSearchQuery:false,
      };
      if(response.status===200&&/text\/html/i.test(response.contentType)){
        const $=load(response.text);
        evidence.pageTitle=$("title").first().text().slice(0,120);
        evidence.productIdLinks=$("a[href]").toArray().filter(a=>{
          try{
            const u=new URL($(a).attr("href")||"",GOOGLE_ALLOWED_NON_SEARCH_LANDING);
            return u.origin==="https://www.google.com"&&
              /^\/shopping\/product\/\d+\/?$/.test(u.pathname);
          }catch{return false;}
        }).length;
        evidence.embeddedJsonLdProductNodes=$('script[type="application/ld+json"]')
          .toArray().slice(0,10).reduce((count,node)=>{
            try {
              const data=JSON.parse($(node).html()||"null");
              const nodes=Array.isArray(data)?data:[data];
              return count+nodes.filter(d=>d?.["@type"]==="Product").length;
            }catch{return count;}
          },0);
        // Landing data is neither query-matched nor PDP-verified.
      }
      report.nonQueryLanding=evidence;
    }
    report.state=report.eligibleQueryAcquisition?
      "ROBOT_ADMITTED_QUERY_EXISTS_NOT_FETCHED":"DIRECT_SEARCH_ROBOTS_BLOCKED";
  }
}catch(e){
  report.state="ROBOTS_FETCH_OR_EVALUATION_FAILED";
  report.errorClass=e?.name==="AbortError"?"TIMEOUT":
    e?.message==="CONTENT_TOO_LARGE"?"RESPONSE_TOO_LARGE":"TRANSPORT_OR_POLICY_ERROR";
  process.exitCode=1;
}finally{
  report.directQueriesFetched=searchRequests;
  report.totalGoogleNetworkRequests=actualRequests;
  await writeFile(REPORT_FILE,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
