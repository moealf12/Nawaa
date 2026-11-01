// NAWAA source-access semantics. Pure bounded decisions; no transport, proxy,
// inventory claims, persistence, credentials, or speculative offer promotion.
const RATE_LIMIT_FALLBACK_MS=60_000;
const MAX_RETRY_AFTER_MS=30*24*60*60*1000;

const outcome=(failureClass)=>({
  failureClass,
  productAvailability:"unknown",
  retryableNow:false,
});

export function classifySourceHttpStatus(status){
  const code=Number(status);
  if(code===403)return outcome("HTTP_403_ACCESS_DENIED");
  if(code===404)return outcome("HTTP_404_RESOURCE_NOT_FOUND");
  if(code===410)return outcome("HTTP_410_RESOURCE_GONE");
  if(code===429)return outcome("HTTP_429_RATE_LIMITED");
  if(code>=500&&code<=599)return outcome("HTTP_5XX_SOURCE_FAILURE");
  if(code>=200&&code<300)return outcome("HTTP_RESPONSE_RECEIVED");
  if(code>=300&&code<400)return outcome("HTTP_REDIRECT_CHANGED");
  return outcome("HTTP_OTHER_FAILURE");
}

export function parseRetryAfter(header,{now=Date.now()}={}){
  if(typeof header!=="string" || !header.trim() || header.length>128)return null;
  const value=header.trim();
  let ms=null;
  if(/^\d+$/.test(value)){
    const seconds=Number(value);
    if(!Number.isSafeInteger(seconds))return null;
    ms=seconds*1000;
  }else{
    // Date.parse accepts non-HTTP strings such as "-3" as a past date.
    // Require an actual IMF-fixdate Retry-After field before parsing it.
    if(!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(value))return null;
    const date=Date.parse(value);
    if(!Number.isFinite(date))return null;
    ms=Math.max(0,date-now);
  }
  if(!Number.isFinite(ms)||ms<0)return null;
  return Math.min(MAX_RETRY_AFTER_MS,ms);
}

export class SourceHttpError extends Error {
  constructor(status,{retryAfterMs=null}={}){
    super("HTTP "+status);
    this.name="SourceHttpError";
    this.status=status;
    this.failureClass=classifySourceHttpStatus(status).failureClass;
    this.retryAfterMs=Number.isFinite(retryAfterMs)?retryAfterMs:null;
    this.productAvailability="unknown";
  }
}

export function classifySourceError(error){
  if(error?.failureClass)return outcome(error.failureClass);
  if(error?.name==="TimeoutError"||/deadline_exceeded|timed out/i.test(String(error?.message||"")))
    return outcome("HTTP_TIMEOUT");
  if(error?.name==="AbortError")return outcome("HTTP_ABORTED");
  const match=String(error?.message||"").match(/^HTTP ([1-5]\d{2})(?:\b|$)/);
  return match?classifySourceHttpStatus(Number(match[1])):outcome("SOURCE_TRANSPORT_FAILURE");
}

export function classifySourceObservation({
  status=200,html="",candidates=0,verifiedOffers=0,pricedCandidates=0,catalogObserved=false,
  blockedReason=null,redirectChanged=false,extractionFailed=false,
  identityConflict=false,
}={}){
  if(!(status>=200&&status<300))return classifySourceHttpStatus(status);
  if(blockedReason)return outcome("HTTP_200_BLOCK_PAGE");
  if(redirectChanged)return outcome("HTTP_REDIRECT_CHANGED");
  // A deliberately conservative shell heuristic; unknown markup remains
  // unknown rather than automatically classed as a healthy empty catalog.
  const shell=verifiedOffers===0 && candidates===0 &&
    /<script\b/i.test(html) && /id=["'](?:root|app|__next)["']/i.test(html) &&
    !/<a\b[^>]*href=/i.test(html);
  if(shell)return outcome("HTTP_200_JS_SHELL");
  if(identityConflict)return outcome("PRODUCT_IDENTITY_MISMATCH");
  if(verifiedOffers>0)return outcome("VERIFIED_OFFER_AVAILABLE");
  // A priced search-card candidate is NOT independently verified against a
  // sellable SKU/PDP. Keep this state separate from trusted live offers.
  if(pricedCandidates>0)return outcome("CATALOG_CANDIDATE_PRESENT");
  if(extractionFailed)return outcome("EXTRACTION_FAILURE");
  if(catalogObserved&&candidates===0)return outcome("HTTP_200_EMPTY_CATALOG");
  return outcome("CATALOG_RESULT_NOT_FOUND");
}

export function createSourceRateLimitGuard({
  now=Date.now,
  denyThreshold=2,
  denyCooldownMs=300_000,
}={}){
  const blockedUntil=new Map();
  const accessDenials=new Map();
  // Access denial is not inventory evidence and is never a permanent ban.
  // Only two consecutive explicit HTTP 403 responses enable a bounded,
  // process-local cooldown. A later request probes again after expiry.
  const threshold=Number.isSafeInteger(denyThreshold)&&denyThreshold>=2
    ?denyThreshold:2;
  const cooldown=Number.isSafeInteger(denyCooldownMs)&&denyCooldownMs>=1_000
    ?Math.min(denyCooldownMs,1_800_000):300_000;
  function canRequest(id){
    const block=blockedUntil.get(id);
    if(!block)return {allowed:true,retryAfterMs:0,failureClass:null};
    const remaining=Math.max(0,block.until-now());
    if(remaining===0){
      blockedUntil.delete(id);
      return {allowed:true,retryAfterMs:0,failureClass:null};
    }
    return {allowed:false,retryAfterMs:remaining,failureClass:block.failureClass};
  }
  function record429(id,retryAfterHeader){
    if(!id)return {allowed:false,retryAfterMs:0,failureClass:"HTTP_429_RATE_LIMITED"};
    const parsed=parseRetryAfter(retryAfterHeader,{now:now()});
    const delay=Math.max(1000,parsed??RATE_LIMIT_FALLBACK_MS);
    const previous=blockedUntil.get(id);
    const until=Math.max(previous?.until||0,now()+delay);
    // Never reduce an existing Retry-After window because of a later 403.
    blockedUntil.set(id,{until,failureClass:previous?.until>now()
      ?previous.failureClass:"HTTP_429_RATE_LIMITED"});
    accessDenials.delete(id);
    return canRequest(id);
  }
  function record403(id){
    if(!id)return {allowed:true,retryAfterMs:0,failureClass:null};
    const failures=(accessDenials.get(id)||0)+1;
    accessDenials.set(id,failures);
    if(failures>=threshold){
      const previous=blockedUntil.get(id);
      if(!previous||previous.until<=now())
        blockedUntil.set(id,{until:now()+cooldown,failureClass:"HTTP_403_ACCESS_DENIED"});
    }
    return canRequest(id);
  }
  function recordNon403(id){
    if(id)accessDenials.delete(id);
  }
  function reset(id=null){
    if(id){blockedUntil.delete(id);accessDenials.delete(id);}
    else {blockedUntil.clear();accessDenials.clear();}
  }
  return {canRequest,record429,record403,recordNon403,reset};
}

// Process-local source guard; no persisted global inventory or product state.
export const sourceRateLimitGuard=createSourceRateLimitGuard();
