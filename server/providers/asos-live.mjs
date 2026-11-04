// ASOS user-initiated validation coordinator. No background polling, fan-out,
// bypass transport, shared-cache publication, or direct network dependency.
import {parseAsosSearchCards} from "../../src/asos-search-cards.mjs";
import {verifyAsosPdpEvidence} from "../../src/asos-pdp-evidence.mjs";

export const asosLiveConfigured=()=>process.env.NAWAA_ASOS_LIVE_ENABLED==="1"&&
  process.env.NAWAA_ASOS_SOURCE_AUTHORIZED==="1";

export async function validateAsosLiveSearch({
  query,html,searchUrl,finalUrl,fetchPdp,signal,
  maxPdp=2,clock=()=>new Date().toISOString(),
}={}){
  if(typeof fetchPdp!=="function")throw new TypeError("ASOS_PDP_FETCHER_REQUIRED");
  signal?.throwIfAborted();
  const parsed=parseAsosSearchCards(html,query,
    {requestedUrl:searchUrl,finalUrl,maxCards:80});
  const results=[],accepted=[];
  // A valid listing response is necessary but not sufficient.
  if(parsed.diagnostics.status!=="PARSED_GB_SEARCH")return {
    candidates:parsed.candidates.length,accepted,results,
    diagnostics:{status:parsed.diagnostics.status,source:"asos-global",
      customerPublishable:false,validated:0,unknown:0,outOfStock:0,
      searchCards:parsed.diagnostics},
  };
  const budget=Math.max(0,Math.min(2,Number.isFinite(maxPdp)?Math.floor(maxPdp):2));
  for(const candidate of parsed.candidates.slice(0,budget)){
    signal?.throwIfAborted();
    let evidence;
    try{
      const page=await fetchPdp(candidate.sourceUrl,{signal});
      signal?.throwIfAborted();
      evidence=verifyAsosPdpEvidence(page?.html,candidate,{
        finalUrl:page?.finalUrl||candidate.sourceUrl,observedAt:clock(),
      });
    }catch(error){
      if(signal?.aborted)throw signal.reason||error;
      const status=Number(error?.status||String(error?.message||"").match(/\b(?:HTTP|returned)\s+(403|429)\b/i)?.[1]);
      // Never retry a denied product request using alternate browsers or IPs.
      evidence={verified:false,reason:status===403?"HTTP_403_ACCESS_DENIED":
        status===429?"HTTP_429_RATE_LIMITED":"PDP_REQUEST_FAILED",
        availability:"unknown"};
      results.push({productId:candidate.productId,variantId:candidate.variantId,...evidence});
      if(status===403||status===429)break;
      continue;
    }
    results.push({productId:candidate.productId,variantId:candidate.variantId,...evidence});
    if(evidence.verified)accepted.push({...candidate,
      // Do not claim that a particular size can be purchased.
      availability:"unknown",colourwayAvailability:evidence.colourwayAvailability,
      sizeAvailability:"unknown",sizeStockVerified:false,
      price:evidence.price,observedAt:evidence.observedAt,
      priceEvidence:"COLOURWAY_PDP_PRICE_PARITY_ONLY"});
  }
  const unknown=results.filter(x=>x.availability==="unknown").length;
  const outOfStock=results.filter(x=>x.availability==="out_of_stock").length;
  return {candidates:parsed.candidates.length,accepted,results,
    diagnostics:{status:accepted.length?"VERIFIED_PDP_CANDIDATES":"NO_VERIFIED_PDP_CANDIDATES",
      source:"asos-global",customerPublishable:false,
      validated:accepted.length,unknown,outOfStock,
      sizeStockVerified:0,shippingToSaudiVerified:false,
      checked:results.length,pdpBudget:budget,searchCards:parsed.diagnostics},
  };
}
