#!/usr/bin/env node
// NAWAA 1688 MOBILE LIVE PROBE — staging only, no customer data writes.
// The src_cna URL parameter supplied by a browser is intentionally omitted:
// it can be a session/tracking identifier and is not part of product identity.
import {writeFile} from "node:fs/promises";
import {inspect1688MobileHomepage} from "../src/1688-mobile-home-evidence.mjs";

const PAGE = "https://m.1688.com/?callByHgJs=1&__removesafearea__=1";
const REPORT = "1688-mobile-home-live.json";
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const result = {
  schema:"nawaa.1688.mobile-home-live.v1",
  checkedOutSha:process.env.GITHUB_SHA||null,
  prHeadSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  observedAt:new Date().toISOString(),
  source:"1688-cn",canonicalOrigin:"https://m.1688.com/",
  inputMode:"same_mobile_entry_without_src_cna",liveOnly:true,
  noProxy:true,noStealth:true,noRetries:true,
  customerPublished:false,pdpPricesVerified:0,
  stages:[],conclusion:"NOT_RUN",
};
function classifyError(error){
 const msg=String(error?.message||"");
 if(error?.name==="TimeoutError"||/timeout|timed out/i.test(msg))return "TIMEOUT";
 if(/ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(msg))return "DNS_FAILURE";
 if(/Executable doesn't exist|browserType\.launch/.test(msg))return "BROWSER_BINARY_OR_LAUNCH_ERROR";
 return "SOURCE_TRANSPORT_OR_BROWSER_ERROR";
}
async function loadBody(response){
 const parts=[];let size=0;
 try{
   for await(const p of response.body||[]) {
     size+=p.byteLength;
     if(size>MAX_BYTES)throw Error("RESPONSE_TOO_LARGE");
     parts.push(Buffer.from(p));
   }
 }catch(e){await response.body?.cancel?.().catch(()=>{});throw e;}
 return Buffer.concat(parts).toString("utf8");
}
async function transportFetch(){
 const stage={transport:"node_fetch",requests:1};const start=performance.now();
 try{
   const response=await fetch(PAGE,{
     method:"GET",redirect:"manual",signal:AbortSignal.timeout(TIMEOUT_MS),
     headers:{
       "user-agent":"NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)",
       accept:"text/html,application/xhtml+xml",
       "accept-language":"zh-CN,zh;q=0.9",
     },
   });
   stage.httpStatus=response.status;
   stage.contentType=response.headers.get("content-type")||null;
   const redirect=response.headers.get("location");
   if(redirect){
     try{const u=new URL(redirect,PAGE);stage.redirectHost=u.hostname;stage.redirectPath=u.pathname.slice(0,80);}
     catch{stage.redirectClass="INVALID_REDIRECT";}
   }
   if(response.status===200 && /^text\/html/i.test(stage.contentType||"")){
     const html=await loadBody(response);
     stage.evidence=inspect1688MobileHomepage(html,{finalUrl:PAGE,httpStatus:200});
     stage.state=stage.evidence.state;
   } else {
     await response.body?.cancel?.().catch(()=>{});
     stage.state=response.status===403?"ACCESS_DENIED":
       response.status===429?"RATE_LIMITED":"NO_MOBILE_HTML";
   }
 }catch(e){stage.state=classifyError(e);}
 finally{stage.elapsedMs=Math.round(performance.now()-start);result.stages.push(stage);}
 return stage;
}
async function browserMobile(){
 const stage={transport:"real_mobile_chromium",navigations:0};
 const start=performance.now();let browser;
 try{
   const {chromium}=await import("playwright");
   const executablePath=process.env.NAWAA_CHROME_EXECUTABLE || undefined;
   browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
   const context=await browser.newContext({
     viewport:{width:390,height:844},screen:{width:390,height:844},
     deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:"zh-CN",
   });
   const page=await context.newPage();
   stage.navigations++;
   const response=await page.goto(PAGE,{waitUntil:"domcontentloaded",timeout:TIMEOUT_MS});
   stage.httpStatus=response?.status()??null;
   const final=new URL(page.url());
   stage.finalHost=final.hostname;
   stage.finalPath=final.pathname.slice(0,90);
   if(final.hostname!=="m.1688.com" || /punish|login|_____tmd_____/.test(final.pathname)){
     stage.state="LOGIN_OR_CHALLENGE_REDIRECT";
   } else if(stage.httpStatus!==200){
     stage.state="BROWSER_HTTP_NOT_OK";
   } else {
     // Allow ordinary storefront JS to render; do not interact with login/verification.
     await page.locator("a.goods-container").first().waitFor({
       state:"attached",timeout:4500
     }).catch(()=>{});
     const html=await page.content();
     stage.evidence=inspect1688MobileHomepage(html,{finalUrl:page.url(),httpStatus:200});
     stage.state=stage.evidence.state;
   }
 }catch(e){stage.state=classifyError(e);}
 finally{
   await browser?.close().catch(()=>{});
   stage.elapsedMs=Math.round(performance.now()-start);
   result.stages.push(stage);
 }
 return stage;
}
try{
 const first=await transportFetch();
 if(first.httpStatus===403||first.httpStatus===429)
   result.conclusion="SOURCE_DENIAL_STOP";
 else if(first.evidence?.state==="PROMOTIONAL_PRODUCT_EVIDENCE_ONLY")
   result.conclusion="LIVE_MOBILE_PROMOTIONS_OBSERVED_UNVERIFIED";
 else {
   const second=await browserMobile();
   result.conclusion=second.evidence?.state==="PROMOTIONAL_PRODUCT_EVIDENCE_ONLY" ?
     "LIVE_MOBILE_PROMOTIONS_OBSERVED_UNVERIFIED" :
     "LIVE_MOBILE_CATALOG_NOT_VERIFIED";
 }
}catch(e){result.conclusion=classifyError(e);}
finally{
 result.customerPublishable=false;
 result.retailMoqVerified=0;result.skuVariantVerified=0;
 await writeFile(REPORT,JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify(result,null,2));
}
