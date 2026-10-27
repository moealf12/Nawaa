// NAWAA v22.02 — default-OFF, side-channel-only Decathlon source evidence.
// Does not alter or emit offers, current prices, product IDs, stock, shipping,
// or merchant request volume. No database writes, cache, or logging.
import {attestDecathlonVariantPrice} from "./decathlon-variant-price-ownership.mjs";

const HOST="decathlon.com.sa";
const OBSERVATION_AGE_LIMIT_MS=15_000;

const sourcePath=(raw)=>{
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.hostname!==HOST||u.username||u.password||
       (u.port&&u.port!=="443")||u.hash||u.search ||
       !/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname))return null;
    return u.pathname.replace(/\/+$/,"");
  }catch{return null;}
};

export function isDecathlonShadowEnabled(value=process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW){
  // Explicit opt-in only. "true", arbitrary query parameters and empty
  // env variables cannot accidentally activate the experiment.
  return value==="1";
}

const report=(status,variantPriceOwned=false)=>({
  status,
  variantPriceOwned,
  observationAgeWithinWindow:true,
  sourceFreshnessCertified:false,
  // Price ownership != current buyability, inventory or checkout verification.
  inventoryVerified:false,
  shippingVerified:false,
  trustedOfferEligible:false,
  customerVisible:false,
  publishedToSearch:false,
});

/**
 * Inspect an already fetched PDP. This module never acquires HTML itself.
 * Caller is the existing resolver, not a client-controlled discovery route.
 * No price amount, SKU, URL, customer data or raw markup appears in output.
 */
export function observeDecathlonSearchEvidence({
  enabled=isDecathlonShadowEnabled(),
  requestedUrl,finalUrl,html,
  fetchedAtMs,nowMs=Date.now(),onObservation,
}={}){
  if(enabled!==true)return null;
  const requested=sourcePath(requestedUrl),actual=sourcePath(finalUrl);
  if(!requested||!actual||requested!==actual)return null;
  const age=nowMs-fetchedAtMs;
  let result;
  if(!Number.isFinite(fetchedAtMs)||!Number.isFinite(nowMs)||
     fetchedAtMs<=0||age<0||age>OBSERVATION_AGE_LIMIT_MS){
    result={...report("OBSERVATION_TIME_INVALID"),observationAgeWithinWindow:false};
  }else{
    try{
      const attested=attestDecathlonVariantPrice(html,finalUrl);
      result=report(attested.status,attested.variantPriceOwned===true);
    }catch{
      result=report("SOURCE_EVIDENCE_UNAVAILABLE");
    }
  }
  // Diagnostic sink is entirely optional. A failing consumer cannot alter
  // transport behavior or the existing search result.
  try{if(typeof onObservation==="function")onObservation(result);}catch{}
  return result;
}
