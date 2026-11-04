#!/usr/bin/env node
// EXPERIMENT ONLY: controlled first-party Noon Saudi transport differential.
// User-reported merchant permission. No proxies, stealth, credentials, catalog writes,
// cache promotion, synthetic products, retries, or customer-facing integration.
// A valid HTTP 200 is not itself proof of a product offer.
import {writeFile} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import {extractNoonSaudiCatalogCards} from "../src/noon-sa-catalog.mjs";
import {extractNoonSaudiSearchCardEvidence} from "../src/noon-sa-search-card-evidence.mjs";

const ORIGIN="https://www.noon.com";
const HOME=ORIGIN+"/saudi-en/";
const QUERY="iPhone 17 256GB";
const SEARCH=ORIGIN+"/saudi-en/search/?q="+encodeURIComponent(QUERY);
const MAX_BYTES=8_000_000;
const TIMEOUT_MS=10_000;
const FILE="noon-sa-transport-matrix.json";
const USER_AGENT="NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)";
const report={
  schema:"nawaa.noon-sa.transport-matrix.v1",
  testedHeadSha:process.env.PULL_REQUEST_HEAD_SHA||null,
  checkedOutMergeSha:process.env.GITHUB_SHA||null,
  observedAt:new Date().toISOString(),
  query:QUERY,
  source:"noon-sa",
  liveOnly:true,
  productionWrites:false,
  customerPublishable:false,
  browserStealth:false,
  proxies:false,
  attemptsPerTransport:1,
  modes:[],
  conclusion:"NOT_RUN",
};

const sameHost=raw=>{
  try{
    const u=new URL(raw);
    return u.protocol==="https:"&&u.hostname==="www.noon.com"&&
      !u.username&&!u.password&&(!u.port||u.port==="443");
  }catch{return false}
};
const statusClass=status=>status===403?"ACCESS_DENIED":
  status===429?"RATE_LIMITED":
  status>=500?"UPSTREAM_5XX":
  status>=300?"REDIRECT_OR_OTHER":
  status>=200&&status<300?"HTTP_OK":"HTTP_FAILED";
const safeError=e=>{
  const m=String(e?.name||"");
  const code=String(e?.code||"");
  return /Timeout/i.test(m)||code==="ETIMEDOUT"?"TIMEOUT":
    /Abort/i.test(m)?"ABORTED":
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/.test(code)?"NETWORK_"+code:
    "TRANSPORT_ERROR";
};
function productEvidence(html){
  if(typeof html!=="string"||Buffer.byteLength(html,"utf8")>MAX_BYTES)
    return {state:"HTML_TOO_LARGE",catalogOffers:0,searchCards:0,conflicts:0};
  const catalog=extractNoonSaudiCatalogCards(html,QUERY,8);
  const search=extractNoonSaudiSearchCardEvidence(html,QUERY,{limit:8});
  const catalogOffers=Array.isArray(catalog)?catalog.length:0;
  const searchCards=Array.isArray(search.candidates)?search.candidates.length:0;
  return {
    state:catalogOffers||searchCards?"SOURCE_PRICE_EVIDENCE_OBSERVED":"NO_VALID_PRICE_EVIDENCE",
    catalogOffers,searchCards,
    searchState:search.status||null,
    conflicts:Array.isArray(search.conflicts)?search.conflicts.length:0,
    // No raw HTML, cookies, user IDs, request headers, or merchant response body.
  };
}
async function boundedHtml(response){
  if(!response.ok)return null;
  const ct=response.headers.get("content-type")||"";
  if(!/text\/html|application\/xhtml\+xml/i.test(ct))return null;
  const chunks=[];
  const reader=response.body?.getReader();
  if(!reader)return "";
  let bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES)throw Object.assign(new Error("HTML_TOO_LARGE"),{code:"HTML_TOO_LARGE"});
      chunks.push(value);
    }
  }finally{reader.releaseLock()}
  return Buffer.concat(chunks.map(x=>Buffer.from(x))).toString("utf8");
}
function captureCookies(jar,headers){
  // Session cookies are transient, sent only to the same pinned Noon host,
  // never printed, persisted, or forwarded to third parties.
  for(const raw of headers.getSetCookie?.()||[]){
    const item=raw.split(";")[0];
    const idx=item.indexOf("=");
    if(idx<=0||item.length>2048)continue;
    const name=item.slice(0,idx);
    if(/^[a-z0-9_!#$%&'*+.^~-]{1,100}$/i.test(name)&&jar.size<24)
      jar.set(name,item.slice(idx+1));
  }
}
async function documentFetch(raw,jar){
  let url=raw;
  for(let redirect=0;redirect<=2;redirect++){
    if(!sameHost(url))return {status:null,classification:"UNSAFE_REDIRECT",html:null};
    const headers={
      accept:"text/html,application/xhtml+xml",
      "accept-language":"en-SA,en;q=0.9,ar-SA;q=0.8",
      "user-agent":USER_AGENT,
    };
    if(jar.size)headers.cookie=[...jar].map(([k,v])=>k+"="+v).join("; ");
    const response=await fetch(url,{
      method:"GET",headers,redirect:"manual",signal:AbortSignal.timeout(TIMEOUT_MS),
    });
    captureCookies(jar,response.headers);
    if(response.status>=300&&response.status<400){
      const location=response.headers.get("location");
      if(!location)return {status:response.status,classification:"REDIRECT_WITHOUT_LOCATION",html:null};
      url=new URL(location,url).href;
      continue;
    }
    return {status:response.status,classification:statusClass(response.status),
      html:await boundedHtml(response)};
  }
  return {status:null,classification:"TOO_MANY_REDIRECTS",html:null};
}
async function sessionProbe(){
  const output={mode:"http_session",startedAt:new Date().toISOString(),requests:0};
  const start=performance.now();
  const cookies=new Map();
  try{
    const home=await documentFetch(HOME,cookies);
    output.requests++;
    output.homeStatus=home.status;
    output.homeClass=home.classification;
    if(home.classification!=="HTTP_OK"){
      output.state="SESSION_HOME_UNAVAILABLE";
      return output;
    }
    const search=await documentFetch(SEARCH,cookies);
    output.requests++;
    output.searchStatus=search.status;
    output.searchClass=search.classification;
    output.evidence=search.html?productEvidence(search.html):null;
    output.state=output.evidence?.state||search.classification;
    return output;
  }catch(e){
    output.state=safeError(e);
    return output;
  }finally{output.elapsedMs=Math.round(performance.now()-start)}
}
function browserErrorKind(e){
  const m=String(e?.message||"");
  const c=String(e?.code||"");
  // Chromium exposes safe navigation error codes; never log the full URL/message.
  const navigationCode=m.match(/net::(ERR_[A-Z0-9_]+)/i)?.[1];
  if(navigationCode)return navigationCode.slice(0,60).toUpperCase();
  if(c==="ERR_MODULE_NOT_FOUND"||/Cannot find (?:package|module)/i.test(m))return "PACKAGE_NOT_INSTALLED";
  if(/Executable doesn't exist|browserType\.launch:.*not found/i.test(m))return "BROWSER_BINARY_MISSING";
  if(/Host system is missing dependencies|error while loading shared libraries/i.test(m))return "HOST_DEPENDENCIES_MISSING";
  if(/Failed to launch|Browser closed|Target page, context or browser has been closed/i.test(m))return "BROWSER_LAUNCH_OR_CLOSED";
  if(/ERR_NAME_NOT_RESOLVED|ERR_DNS_PROBE_FINISHED_NXDOMAIN/i.test(m))return "DNS_RESOLUTION";
  if(/ERR_CONNECTION|ERR_TUNNEL_CONNECTION/i.test(m))return "NETWORK_CONNECTION";
  if(/Timeout|timed out/i.test(m))return "TIMEOUT";
  return "OTHER_BROWSER_ERROR";
}
async function browserProbe(){
  const output={mode:"chromium_browser",startedAt:new Date().toISOString(),requests:0};
  const start=performance.now();
  let browser;
  let phase="module_import";
  try{
    // Genuine browser navigation, not patched navigator, synthetic TLS, or stealth.
    const {chromium}=await import("playwright");
    phase="browser_launch";
    browser=await chromium.launch({headless:true});
    phase="new_context";
    const context=await browser.newContext({
      locale:"en-SA",timezoneId:"Asia/Riyadh",
      viewport:{width:1280,height:900},
    });
    const page=await context.newPage();
    phase="navigate_home";
    const home=await page.goto(HOME,{waitUntil:"domcontentloaded",timeout:TIMEOUT_MS});
    output.requests++;
    output.homeStatus=home?.status()??null;
    output.homeClass=statusClass(output.homeStatus??0);
    if(output.homeClass!=="HTTP_OK"){
      output.state="BROWSER_HOME_UNAVAILABLE";
      return output;
    }
    phase="navigate_search";
    const search=await page.goto(SEARCH,{
      waitUntil:"domcontentloaded",timeout:TIMEOUT_MS,
    });
    output.requests++;
    output.searchStatus=search?.status()??null;
    output.searchClass=statusClass(output.searchStatus??0);
    if(output.searchClass!=="HTTP_OK"){
      output.state=output.searchClass;
      return output;
    }
    phase="parse_page";
    // Allow a bounded period for client-side search cards to render.
    await page.locator("h1, a[href*='/p/']").first().waitFor({
      state:"attached",timeout:4000,
    }).catch(()=>{});
    const html=await page.content();
    output.evidence=productEvidence(html);
    output.state=output.evidence.state;
    return output;
  }catch(e){
    output.state=safeError(e);
    output.errorStage=phase;
    output.errorKind=browserErrorKind(e);
    return output;
  }finally{
    await browser?.close().catch(()=>{});
    output.elapsedMs=Math.round(performance.now()-start);
  }
}

try{
  report.modes.push(await sessionProbe());
  report.modes.push(await browserProbe());
  const productive=report.modes.filter(m=>
    m.evidence?.state==="SOURCE_PRICE_EVIDENCE_OBSERVED");
  const denials=report.modes.filter(m=>
    m.homeStatus===403||m.searchStatus===403);
  report.conclusion=productive.length?"LIVE_SEARCH_PRICE_OBSERVED":
    denials.length===report.modes.length?"ALL_TRANSPORTS_DENIED":
    "NO_VERIFIED_SEARCH_PRICE";
  report.customerPublishable=false;
  report.firstPartyPdpVerified=false;
}catch(e){
  report.conclusion="PROBE_EXCEPTION";
  report.failureClass=safeError(e);
}finally{
  await writeFile(FILE,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if(report.conclusion!=="LIVE_SEARCH_PRICE_OBSERVED")process.exitCode=1;
}
