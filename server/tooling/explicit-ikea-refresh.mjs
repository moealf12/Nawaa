// Explicit, zero-scheduler IKEA refresh: official pilot SKU only.
// Admission checks persisted observation age AND atomically reserves a merchant
// request budget *before* making exactly two non-redirecting page requests.
// No customer API endpoints import this file and no background worker calls it.
import {PILOT_PRODUCTS} from "../../src/ikea-pilot-products.mjs";
import {extractProductDocument,fetchHtmlSafe} from "../url-resolver.mjs";
import {verifyIkeaVisiblePrice} from "./ikea-dom-price-proof.mjs";
import {enqueueCertifiedMerchantProduct} from "./merchant-observation-producer.mjs";
import {getOfferPriceHistory} from "../persistence.mjs";
import {getDurableRefreshBudget,reserveDurableRefreshRequests} from "./durable-refresh-budget.mjs";
import {planIkeaRefresh} from "./source-refresh-policy.mjs";
const SOURCE="ikea-sa";
function requireManualFlags(env,key,boss){
 for(const field of [
  "NAWAA_ENABLE_EXPLICIT_MERCHANT_REFRESH",
  "NAWAA_ENABLE_BACKGROUND_JOBS",
  "NAWAA_ENABLE_CERTIFIED_INGESTION",
  "NAWAA_ENABLE_REFRESH_BUDGET"
 ])if(env?.[field]!=="1")throw new Error("explicit_merchant_refresh_disabled");
 if(!key||key!==env.NAWAA_INGESTION_SIGNING_KEY||
    Buffer.byteLength(key,"utf8")<32)throw new Error("refresh_signing_key_mismatch");
 if(typeof boss?.send!=="function")throw new Error("merchant_queue_not_available");
}
export async function runExplicitIkeaRefresh({
 url,boss,key,env=process.env,clock=Date.now,
 readHistory=getOfferPriceHistory,
 readBudget=getDurableRefreshBudget,
 reserveBudget=reserveDurableRefreshRequests,
 publish=enqueueCertifiedMerchantProduct
}={}){
 requireManualFlags(env,key,boss);
 const approved=PILOT_PRODUCTS.find(p=>p.url===url);
 if(!approved)throw new Error("not_an_approved_refresh_pilot_product");
 if(typeof clock!=="function")throw new Error("refresh_clock_required");
 const now=clock();
 if(!Number.isSafeInteger(now)||now<0)throw new Error("invalid_refresh_clock");
 // Read-only database queries only until the admission and atomic quota claim.
 const [history,budget]=await Promise.all([
  readHistory(approved.url,{sourceName:SOURCE,limit:1}),
  readBudget(SOURCE,{clock:()=>now})
 ]);
 if(!history?.configured||!Array.isArray(history.observations))
  throw new Error("refresh_history_unavailable");
 const lastSuccessfulAt=history.observations[0]?.observedAt??null;
 const plan=planIkeaRefresh({
  products:[approved],
  observations:{[approved.sku]:{lastSuccessfulAt}},
  budget:{windowStartedAt:budget.windowStartedAt,requestsUsed:budget.requestsUsed},
  now
 });
 if(!plan.planned.length)return {
  queued:false,admitted:false,reason:plan.entries[0].reason,estimatedRequests:0
 };
 const claimed=await reserveBudget(SOURCE,{clock:()=>now});
 if(!claimed?.admitted)return {
  queued:false,admitted:false,reason:claimed?.reason||"budget_reservation_denied",
  estimatedRequests:0
 };
 // Redirects can cost extra HTTP hops. maxRedirects=0 makes a two-request
 // quota reservation precisely bound two GETs, even on a failed attempt.
 // Both transports reuse DNS pinning/SSRF guards in the existing resolver.
 const extract=(candidate)=>extractProductDocument(candidate,{maxRedirects:0});
 const verifyVisiblePrice=(offer)=>verifyIkeaVisiblePrice(offer,{
  fetchPage:(candidate)=>fetchHtmlSafe(candidate,0,{maxRedirects:0})
 });
 const issued=await publish(boss,{sourceId:SOURCE,url:approved.url,key,clock,
  extract,verifyVisiblePrice});
 return {
  queued:issued.queued===true,admitted:true,jobId:issued.jobId??null,
  chargedRequests:2,evidence:issued.evidence||null
 };
}
