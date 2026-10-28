// Bounded read-only merchant evidence inspection: at most two sitemap GETs
// and one source-owned PDP GET. No checkout, cart, quote, inventory endpoint,
// database mutation, price publication or private source data output.
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {auditDecathlonSitemap} from "./audit-sitemap-discovery.mjs";
import {fetchHtmlSafe} from "../server/url-resolver.mjs";
import {evaluateDecathlonFulfillmentReadiness} from "../server/decathlon-fulfillment-evidence.mjs";

const candidateUrl=raw=>{
  try{
    const u=new URL(raw);
    return u.protocol==="https:"&&u.hostname==="decathlon.com.sa"&&!u.search&&
      !u.hash&&!u.username&&!u.password&&(!u.port||u.port==="443")&&
      /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname);
  }catch{return false;}
};
const base=(status,requests=0)=>({
  schemaVersion:"nawaa.decathlon.fulfillment-evidence.v1",
  sourceId:"decathlon-sa",sourceStatus:status,pdpRequests:requests,
  availabilitySignalStatus:"NOT_OBSERVED",merchantAvailableSignal:null,
  selectedVariantMatched:false,inventoryVerified:false,
  shippingVerified:false,shippingPriceVerified:false,
  deliveryDestinationVerified:false,checkoutVerified:false,
  quoteAllowed:false,customerVisible:false,publishedOfferCount:0,
});

export async function auditDecathlonFulfillmentEvidence({
  fetchSitemap=fetch,fetchPdp=fetchHtmlSafe,signal,
}={}){
  let sampleUrl=null;
  const sitemap=await auditDecathlonSitemap({
    fetchPage:fetchSitemap,signal,
    onProductSample:urls=>{sampleUrl=urls.find(candidateUrl)||null;},
  });
  const out={...base(sitemap.status),sitemapRequests:sitemap.requests,
    catalogComplete:sitemap.complete,sitemapProductCandidates:sitemap.productCandidates};
  if(!sampleUrl||["SOURCE_DENIED","SOURCE_RATE_LIMITED","SOURCE_UNAVAILABLE","XML_INVALID"].includes(sitemap.status))
    return out;
  out.pdpRequests=1;
  try{
    const deadline=AbortSignal.timeout(5500);
    const combined=signal?AbortSignal.any([signal,deadline]):deadline;
    const page=await fetchPdp(sampleUrl,0,{signal:combined});
    if(!candidateUrl(page.finalUrl) ||
      new URL(page.finalUrl).pathname.replace(/\/+$/,"")!==
      new URL(sampleUrl).pathname.replace(/\/+$/,"")){
      out.availabilitySignalStatus="PDP_IDENTITY_CONFLICT";
      return out;
    }
    const value=evaluateDecathlonFulfillmentReadiness(page.html,sampleUrl);
    out.availabilitySignalStatus=value.status;
    out.merchantAvailableSignal=value.merchantAvailableSignal;
    out.selectedVariantMatched=value.selectedVariantMatched;
    return out;
  }catch{
    out.availabilitySignalStatus="SOURCE_NOT_ACCESSIBLE";
    return out;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  process.stdout.write(JSON.stringify(await auditDecathlonFulfillmentEvidence(),null,2)+"\n");
