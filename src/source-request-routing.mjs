// NAWAA public-source request decisions. No origin/proxy IP switching,
// inventory assertions, cached-price promotion or destructive index updates.
const SMALL_RETRY_CAP=2;

export function chooseSourceTransport({sourceId,approvedSourceIds=[],optIn=false}={}) {
  return optIn && typeof sourceId==="string" && approvedSourceIds.includes(sourceId)
    ? "impit" : "native";
}

export function nextSourceRequestAction({status,attempt=0,maxRetries=1,retryAfterMs=null}={}) {
  const base={
    routeAfterFailure:false,
    productAvailability:"unknown",
    removeFromIndex:false,
    retryAfterMs:null,
    transportAction:"stop",
  };
  if(status===403)return {...base,reason:"ACCESS_DENIED"};
  if(status===429)return {...base,reason:"RATE_LIMITED",retryAfterMs:Number.isFinite(retryAfterMs)&&retryAfterMs>=0?retryAfterMs:null};
  if(status===404||status===410)
    return {...base,reason:status===404?"RESOURCE_NOT_FOUND":"RESOURCE_GONE",transportAction:"reverify_later"};
  if([408,425,500,502,503,504].includes(Number(status)) &&
     Number.isInteger(attempt) && attempt>=0 &&
     attempt<Math.min(SMALL_RETRY_CAP,Math.max(0,Math.floor(Number(maxRetries)||0))))
    return {...base,reason:"TRANSIENT_FAILURE",transportAction:"retry_same_transport"};
  return {...base,reason:"NO_RETRY"};
}

function publicUrl(raw) {
  try {
    const url=new URL(raw);
    if(url.protocol!=="https:" || url.username || url.password)return null;
    if(!url.hostname || url.hostname==="localhost")return null;
    url.hash="";
    return url.href;
  } catch { return null; }
}

// Sitemap absence signals revalidation only. It cannot prove an SKU is sold
// out or authorize automatic deletion from Meilisearch/PostgreSQL. The caller
// must supply a complete, successful current sitemap observation.
export function reconcilePublicSitemap({
  indexedUrls=[],observedUrls=[],sitemapObserved=false,maxEntries=10_000,
}={}) {
  const cap=Math.min(10_000,Math.max(0,Math.floor(Number(maxEntries)||0)));
  const current=new Set(observedUrls.slice(0,cap).map(publicUrl).filter(Boolean));
  const complete=Boolean(sitemapObserved) &&
    Array.isArray(indexedUrls) && Array.isArray(observedUrls) &&
    indexedUrls.length<=cap && observedUrls.length<=cap;
  if(!complete)return {complete:false,missing:[],reason:"INCOMPLETE_SITEMAP_EVIDENCE"};
  const missing=[];
  for(const raw of indexedUrls){
    const url=publicUrl(raw);
    if(!url||current.has(url))continue;
    missing.push({
      url,
      status:"SITEMAP_ABSENT_REVERIFY",
      productAvailability:"unknown",
      removeFromIndex:false,
      priceStatus:"not_revalidated",
    });
  }
  return {complete:true,missing,reason:"REVALIDATION_ONLY"};
}
