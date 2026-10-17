// Pure classification of already-reported source errors. This is observability,
// not suppression: neither the original errors nor coverage.partial is changed.
const CORE_SOURCES = new Set([
  "extra-unbxd", "jarir-direct", "sharafdg-algolia", "virgin-ae",
  "free-storefronts:amazon-sa", "swarovski-direct",
]);
const safeId = value => typeof value === "string" && /^[a-z0-9_-]{1,80}$/i.test(value) ? value : null;

export function summarizeSourceFailures(errors = []) {
  const types = {http:0,transport:0,timeout:0,unverifiedOffers:0,malformed:0,other:0};
  const core = new Set(), optional = new Set();
  let searchErrors = 0;
  for(const issue of Array.isArray(errors) ? errors : []) {
    const rawId=safeId(issue?.sourceId) || safeId(issue?.provider);
    // Batched free-storefront errors describe individual merchant markets.
    const sourceId=rawId==="free-storefronts" && safeId(issue?.market)
      ? "free-storefronts:"+issue.market : rawId;
    if(!sourceId || sourceId==="search") {searchErrors++;continue;}
    const msg=String(issue?.error||issue?.message||"");
    const kind=/no verified structured-price product pages found/i.test(msg) ? "unverifiedOffers"
      : /\bHTTP\s*[345]\d{2}\b/i.test(msg) ? "http"
      : /deadline|timeout|timed out/i.test(msg) ? "timeout"
      : /fetch failed|network|connect|dns|socket|econn|enotfound/i.test(msg) ? "transport"
      : /malformed|invalid (?:response|json|payload)|parse error/i.test(msg) ? "malformed"
      : "other";
    types[kind]++;
    (CORE_SOURCES.has(sourceId) ? core : optional).add(sourceId);
  }
  return {errorsReported:Array.isArray(errors)?errors.length:0,
    sourcesAffected:core.size+optional.size,
    coreSourcesAffected:core.size,optionalSourcesAffected:optional.size,
    searchErrors,types};
}

// Customer wording distinguishes stream completion, deadline and coverage.
// A successful HTTP/SSE completion does not certify all merchant searches.
export function coverageStatusText(coverage = {}, errors = []) {
  if(coverage?.deadlineExceeded) return "انتهت مهلة البحث قبل اكتمال جميع المصادر";
  if(Number(coverage?.providersPending)>0) return "ما زال فحص بعض المصادر جاريًا";
  const info=coverage?.sourceFailures || summarizeSourceFailures(errors);
  if(!info.errorsReported) return "";
  if(info.coreSourcesAffected && info.optionalSourcesAffected)
    return "نتائج جزئية: تعذر التحقق من بعض المصادر الأساسية والإضافية";
  if(info.coreSourcesAffected)
    return "نتائج جزئية: تعذر التحقق من بعض المصادر الأساسية";
  if(info.optionalSourcesAffected)
    return "نتائج جزئية: تعذر التحقق من بعض المصادر الإضافية";
  return "نتائج جزئية: بعض مصادر البحث لم تستجب بشكل كامل";
}
