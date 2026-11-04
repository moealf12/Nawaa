// OLIVE YOUNG Global isolated and opt-in live evidence coordination.
// No background crawling, follow-on API retries, or automatic PDP fan-out.
import {oliveYoungSearchUrl,oliveYoungProductIdentity,
  observeOliveYoungSearch,observeOliveYoungPdp} from "../../src/oliveyoung-evidence.mjs";

export const oliveYoungLiveConfigured=()=>
  process.env.NAWAA_OLIVEYOUNG_LIVE_ENABLED==="1" &&
  process.env.NAWAA_OLIVEYOUNG_SOURCE_AUTHORIZED==="1";

export function evaluateOliveYoungSearch({
  query,html,searchUrl,finalUrl,
}={}){
  const expected=oliveYoungSearchUrl(query);
  const diagnostics=observeOliveYoungSearch(html,{
    query,requestedUrl:searchUrl||expected,finalUrl:finalUrl||searchUrl||expected,
  });
  // A valid result-count header is not priced product evidence. Do not
  // pass this source into the generic per-link PDP harvesting logic.
  return {candidates:0,offers:[],diagnostics:{
    ...diagnostics,liveFetchAttempts:0,customerPublishable:false,
    shippingToSaudiVerified:false,priceEvidence:"UNAVAILABLE",
  }};
}

/** Optional one-PDP verification for a trusted exact product URL.
 * Only invoked by an explicitly authorized caller, never triggered by
 * this source's search shell or a user-supplied arbitrary URL.
 */
export async function verifyOliveYoungKnownProduct({
  productUrl,fetchPdp,signal,
}={}){
  if(typeof fetchPdp!=="function")throw new TypeError("OLIVEYOUNG_PDP_FETCHER_REQUIRED");
  const id=oliveYoungProductIdentity(productUrl);
  if(!id)return {verified:false,status:"PDP_URL_REJECTED",customerPublishable:false};
  signal?.throwIfAborted();
  const response=await fetchPdp(id.sourceUrl,{signal});
  signal?.throwIfAborted();
  return observeOliveYoungPdp(response?.html,{
    requestedUrl:id.sourceUrl,finalUrl:response?.finalUrl||id.sourceUrl,
  });
}
