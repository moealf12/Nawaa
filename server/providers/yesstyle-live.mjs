// Source-scoped, one-shot YesStyle evidence coordinator.
// Executes only when called after a user-initiated search. No crawling jobs,
// rate-limit bypass, retries, unsolicited PDP fanout, or offer publication.
import {extractYesstyleSearchCards} from "../../src/yesstyle-search-cards.mjs";
import {verifyYesstylePdp} from "../../src/yesstyle-pdp-evidence.mjs";
export const yesstyleLiveConfigured=()=>
  process.env.NAWAA_YESSTYLE_SOURCE_AUTHORIZED==="1" &&
  process.env.NAWAA_YESSTYLE_LIVE_ENABLED==="1";

export async function evaluateYesstyleSearch({
  html,query,searchUrl,finalUrl,fetchPdp,signal,maxPdp=2,
}={}){
  if(typeof fetchPdp!=="function")throw new TypeError("YESSTYLE_PDP_FETCHER_REQUIRED");
  signal?.throwIfAborted();
  const parsed=extractYesstyleSearchCards(html,query,{
    requestedUrl:searchUrl,finalUrl,maxCards:100,
  });
  const results=[];
  if(parsed.diagnostics.status!=="PARSED_USD_SEARCH")
    return {candidates:parsed.candidates.length,results,verified:[],
      diagnostics:{status:parsed.diagnostics.status,searchCards:parsed.diagnostics,
        customerPublishable:false,shippingToSaudiVerified:false}};
  const bound=Math.max(0,Math.min(2,Number.isFinite(maxPdp)?Math.floor(maxPdp):2));
  for(const candidate of parsed.candidates.slice(0,bound)){
    signal?.throwIfAborted();
    try{
      const page=await fetchPdp(candidate.sourceUrl,{signal});
      signal?.throwIfAborted();
      const evidence=verifyYesstylePdp(page?.html,candidate,{
        finalUrl:page?.finalUrl||candidate.sourceUrl,
        observedAt:new Date().toISOString(),
      });
      results.push({productId:candidate.productId,...evidence});
    }catch(error){
      if(signal?.aborted)throw signal.reason||error;
      const status=Number(error?.status || 
        String(error?.message||"").match(/\bHTTP\s+(403|429)\b/)?.[1]);
      results.push({productId:candidate.productId,verified:false,
        reason:status===403?"HTTP_403_DENIED":status===429?"HTTP_429_RATE_LIMITED":"PDP_FETCH_FAILED",
        availability:"unknown",customerPublishable:false});
      if(status===403||status===429)break;
    }
  }
  const verified=results.filter(x=>x.verified);
  return {candidates:parsed.candidates.length,results,verified,
    diagnostics:{status:verified.length?"PDP_EVIDENCE_OBSERVED":"NO_TRUSTED_PDP_EVIDENCE",
      checked:results.length,verified:verified.length,
      source:"yesstyle-global",customerPublishable:false,
      shippingToSaudiVerified:false,searchCards:parsed.diagnostics}};
}
