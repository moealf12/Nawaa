// v22.05 single-source Ajax feasibility experiment, NOT a crawler/adapter.
// 2 sitemap GETs max, then one /robots.txt, then max 1 PDP GET and 1
// publicly documented .js GET only if robots permits and explicit opt-in.
// No POST, cart, checkout, payment, session tokens, db or search mutations.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {auditDecathlonSitemap} from "./audit-sitemap-discovery.mjs";
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {
  deriveDecathlonAjaxUrl,evaluateDecathlonRobotsPolicy,
  compareDecathlonAjaxProductWithPdp,decathlonAjaxPolicyLimits,
} from "../server/decathlon-shopify-ajax-evidence.mjs";

const HOST="https://decathlon.com.sa";
const ROBOTS_URL=HOST+"/robots.txt";
async function readBounded(response,maxBytes){
  const contentLength=Number(response.headers.get("content-length"));
  if(Number.isFinite(contentLength)&&contentLength>maxBytes)
    throw Error("RESPONSE_TOO_LARGE");
  if(!response.body)throw Error("NO_RESPONSE_BODY");
  const reader=response.body.getReader(),parts=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes)throw Error("RESPONSE_TOO_LARGE");
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  const data=new Uint8Array(size);let i=0;
  for(const p of parts){data.set(p,i);i+=p.length;}
  return new TextDecoder("utf-8",{fatal:true}).decode(data);
}
const out=()=>({
  schemaVersion:"nawaa.decathlon.ajax-feasibility.v1",
  sourceId:"decathlon-sa",sitemapStatus:"NOT_CHECKED",
  sitemapRequests:0,robotsRequests:0,robotsStatus:"NOT_CHECKED",
  ajaxPathPermitted:false,
  pdpRequests:0,ajaxRequests:0,
  ajaxStatus:"NOT_ATTEMPTED",
  selectedVariantMatched:false,variantPriceCentsMatched:false,
  ajaxPresentmentCurrencyVerified:false,merchantAvailableSignal:null,
  inventoryVerified:false,shippingVerified:false,checkoutVerified:false,
  quoteAllowed:false,customerVisible:false,publishedOfferCount:0,
  note:"Public Shopify Ajax JSON can reflect presentment currency; no inventory, delivery or binding checkout proof.",
});
const timer=(signal)=>{
  const timeout=AbortSignal.timeout(5500);
  return signal?AbortSignal.any([signal,timeout]):timeout;
};
export async function auditDecathlonAjaxFeasibility({
  fetchSitemap=fetch,
  fetchRobots=fetch,fetchAjax=fetch,fetchPdp=fetchHtmlSafe,
  liveProbeEnabled=process.env.NAWAA_DECATHLON_AJAX_LIVE_PROBE==="1",
  signal,
}={}){
  const report=out(),candidates=[];
  // Default disabled means ZERO network calls, including sitemap and robots.
  // After the one-shot live source returned non-JSON, CI must not auto-repeat.
  if(!liveProbeEnabled){
    report.ajaxStatus="PROBE_EXPLICITLY_DISABLED";
    return report;
  }
  const source=await auditDecathlonSitemap({
    fetchPage:fetchSitemap,signal,
    onProductSample:list=>{for(const url of list.slice(0,1))candidates.push(url);},
  });
  report.sitemapStatus=source.status;
  report.sitemapRequests=source.requests;
  if(!candidates.length||
    ["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(source.status))
    return report;
  const productUrl=candidates[0],ajaxUrl=deriveDecathlonAjaxUrl(productUrl);
  if(!ajaxUrl){report.ajaxStatus="INVALID_AJAX_TARGET";return report;}
  report.robotsRequests=1;
  let policy;
  try{
    const response=await fetchRobots(ROBOTS_URL,{
      method:"GET",redirect:"manual",signal:timer(signal),
      headers:{"user-agent":decathlonAjaxPolicyLimits.userAgent,"accept":"text/plain"},
    });
    if(response.status!==200){
      report.robotsStatus=response.status===429?"ROBOTS_RATE_LIMITED":
        response.status===403?"ROBOTS_DENIED":"ROBOTS_UNAVAILABLE";
      return report;
    }
    const body=await readBounded(response,decathlonAjaxPolicyLimits.maxRobotsBytes);
    policy=evaluateDecathlonRobotsPolicy(body,ajaxUrl);
    report.robotsStatus=policy.status;
  }catch{report.robotsStatus="ROBOTS_UNAVAILABLE";return report;}
  report.ajaxPathPermitted=policy.permitted;
  if(!policy.permitted)return report;
  try{
    report.pdpRequests=1;
    const pdp=await fetchPdp(productUrl,0,{signal:timer(signal)});
    if(pdp.finalUrl!==productUrl){
      report.ajaxStatus="PDP_SOURCE_REDIRECT_OR_PATH_MISMATCH";return report;
    }
    report.ajaxRequests=1;
    const response=await fetchAjax(ajaxUrl,{
      method:"GET",redirect:"manual",signal:timer(signal),
      headers:{"user-agent":decathlonAjaxPolicyLimits.userAgent,
        "accept":"application/json"},
    });
    if(response.status!==200){
      report.ajaxStatus=response.status===429?"AJAX_RATE_LIMITED":
        response.status===403?"AJAX_DENIED":
        response.status===404?"AJAX_NOT_FOUND":"AJAX_HTTP_UNAVAILABLE";
      return report;
    }
    if(!/(?:application\/json|text\/json)/i.test(response.headers.get("content-type")||"")){
      report.ajaxStatus="AJAX_NON_JSON_RESPONSE";return report;
    }
    const body=await readBounded(response,decathlonAjaxPolicyLimits.maxAjaxJsonBytes);
    const evidence=compareDecathlonAjaxProductWithPdp({
      pdpHtml:pdp.html,pdpUrl:productUrl,ajaxBody:body,
    });
    report.ajaxStatus=evidence.status;
    report.selectedVariantMatched=evidence.selectedVariantMatched;
    report.variantPriceCentsMatched=evidence.variantPriceCentsMatched;
    report.ajaxPresentmentCurrencyVerified=false;
    report.merchantAvailableSignal=evidence.merchantAvailableSignal;
    return report;
  }catch{
    report.ajaxStatus="AJAX_OR_PDP_UNAVAILABLE";return report;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditDecathlonAjaxFeasibility(),null,2)+"\n");
}
