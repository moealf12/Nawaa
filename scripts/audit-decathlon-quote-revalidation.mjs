// NAWAA v22.03 — bounded LIVE PDP revalidation experiment.
// At most 2 sitemap GETs + 2 PDP GETs for ONE source-owned candidate.
// This only compares source-visible variant price observations and never
// submits a quote, cart, checkout, inventory or shipping request.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {auditDecathlonSitemap} from "./audit-sitemap-discovery.mjs";
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {evaluateDecathlonQuoteReadiness} from "../server/decathlon-quote-readiness.mjs";

const sourceOwned=url=>{
  try{const u=new URL(url);return u.protocol==="https:"&&u.hostname==="decathlon.com.sa"&&
    !u.search&&!u.hash&&!u.username&&!u.password&&
    (!u.port||u.port==="443")&&
    /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname);}
  catch{return false;}
};

export async function auditDecathlonLiveQuoteRevalidation({
  fetchSitemap=fetch,fetchPdp=fetchHtmlSafe,
  now=Date.now,signal,
}={}){
  let candidate=null;
  const sitemap=await auditDecathlonSitemap({
    fetchPage:fetchSitemap,signal,
    onProductSample:urls=>{candidate=urls.find(sourceOwned)||null;},
  });
  const result={
    schemaVersion:"nawaa.decathlon.quote-revalidation.v1",
    sourceId:"decathlon-sa",
    sitemapStatus:sitemap.status,
    sitemapRequests:sitemap.requests,
    catalogComplete:sitemap.complete,
    pdpRequests:0,
    hadTwoIndependentPdpFetches:false,
    revalidationStatus:"NOT_ATTEMPTED",
    selectedVariantUnchanged:false,
    observedPriceUnchanged:false,
    quoteAllowed:false,checkoutAllowed:false,
    customerOfferEligible:false,
    inventoryVerified:false,shippingVerified:false,
    sourcePriceFreshnessCertified:false,
    publishedOfferCount:0,
    info:"Two merchant PDP reads can compare SKU/price, not stock, shipping, checkout, delivery or a binding quote.",
  };
  if(!candidate||["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(sitemap.status))
    return result;
  async function readOnce(id){
    signal?.throwIfAborted();
    const deadline=AbortSignal.timeout(5500);
    const combined=signal?AbortSignal.any([signal,deadline]):deadline;
    result.pdpRequests++;
    const response=await fetchPdp(candidate,0,{signal:combined});
    if(!sourceOwned(response.finalUrl) ||
       new URL(response.finalUrl).pathname.replace(/\/+$/,"")!==
       new URL(candidate).pathname.replace(/\/+$/,"")){
      return null;
    }
    return {
      url:candidate,finalUrl:response.finalUrl,
      html:response.html,httpStatus:200,receivedAtMs:now(),
      requestId:id,
    };
  }
  try{
    const first=await readOnce("initial-request");
    if(!first){result.revalidationStatus="SOURCE_IDENTITY_MISMATCH";return result;}
    const second=await readOnce("independent-revalidation-request");
    if(!second){result.revalidationStatus="SOURCE_IDENTITY_MISMATCH";return result;}
    result.hadTwoIndependentPdpFetches=true;
    const analysis=evaluateDecathlonQuoteReadiness({
      search:first,quote:second,nowMs:now(),
    });
    result.revalidationStatus=analysis.status;
    result.selectedVariantUnchanged=analysis.sameSelectedVariant;
    result.observedPriceUnchanged=analysis.samePriceBetweenObservations;
    // NEVER upgrade any readiness flag even when the source price matches.
    return result;
  }catch{
    result.revalidationStatus="QUOTE_SOURCE_UNAVAILABLE";
    return result;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditDecathlonLiveQuoteRevalidation(),null,2)+"\n");
}
