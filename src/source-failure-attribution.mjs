// NAWAA source failure attribution: diagnostic-only, no writes, no trust promotion.
// Source-provided error strings are untrusted: never emit raw messages, URLs,
// stack traces, request metadata, credentials, or inferred stock availability.
const knownClasses = new Set([
  "HTTP_403_ACCESS_DENIED","HTTP_404_RESOURCE_NOT_FOUND",
  "HTTP_410_RESOURCE_GONE","HTTP_429_RATE_LIMITED",
  "HTTP_5XX_SOURCE_FAILURE","HTTP_TIMEOUT","HTTP_ABORTED",
  "HTTP_200_BLOCK_PAGE","HTTP_200_JS_SHELL","HTTP_200_EMPTY_CATALOG",
  "HTTP_REDIRECT_CHANGED","PRODUCT_IDENTITY_MISMATCH",
  "EXTRACTION_FAILURE","CATALOG_RESULT_NOT_FOUND",
  "SOURCE_TRANSPORT_FAILURE","PRICE_EVIDENCE_INCOMPLETE",
  "NO_VERIFIED_STRUCTURED_PRICE_PDP"
]);
const sourceId = value => typeof value === "string" &&
  /^[a-z0-9][a-z0-9:_-]{0,79}$/i.test(value) ? value.toLowerCase() : "unknown";
const safeQuery = value => typeof value === "string" && value.length <= 96 &&
  /^[\p{L}\p{N} _-]+$/u.test(value) ? value : "unknown";
function fromStatus(value) {
  const status=Number(value);
  if (!Number.isInteger(status)) return null;
  if (status===403) return "HTTP_403_ACCESS_DENIED";
  if (status===404) return "HTTP_404_RESOURCE_NOT_FOUND";
  if (status===410) return "HTTP_410_RESOURCE_GONE";
  if (status===429) return "HTTP_429_RATE_LIMITED";
  if (status>=500&&status<600) return "HTTP_5XX_SOURCE_FAILURE";
  return null;
}
export function classifyFailure(error) {
  if (error && typeof error==="object") {
    if (knownClasses.has(error.failureClass)) return error.failureClass;
    const explicit=fromStatus(error.status??error.httpStatus);
    if (explicit) return explicit;
  }
  const value = typeof error==="string" ? error :
    typeof error?.error==="string" ? error.error :
    typeof error?.message==="string" ? error.message :
    typeof error?.code==="string" ? error.code : "";
  const s=value.slice(0,768).toLowerCase();
  // A bare status in a product name or URL is not authoritative.
  const http=s.match(/(?:^|[\s(:])(?:http(?:\s+status)?|status(?:code)?)\s*[:= ]\s*(403|404|410|429|5\d\d)\b/);
  if (http) return fromStatus(http[1]) || "UNKNOWN";
  if (/\b(?:access.denied|forbidden)\b/.test(s)) return "HTTP_403_ACCESS_DENIED";
  if (/\b(?:rate.limit(?:ed)?|too.many.requests)\b/.test(s)) return "HTTP_429_RATE_LIMITED";
  if (/\b(?:timeout|timed.out|deadline.exceeded|etimedout)\b/.test(s)) return "HTTP_TIMEOUT";
  if (/\b(?:aborterror|aborted|abort_signal)\b/.test(s)) return "HTTP_ABORTED";
  if (/\b(?:identity.mismatch|variant.conflict|sku.mismatch)\b/.test(s)) return "PRODUCT_IDENTITY_MISMATCH";
  if (/\b(?:price.missing|price.not.found|price.evidence)\b/.test(s)) return "PRICE_EVIDENCE_INCOMPLETE";
  if (/\b(?:json.parse|parse.error|invalid.json|extraction.failed)\b/.test(s)) return "EXTRACTION_FAILURE";
  if (/\b(?:js.shell|javascript.shell)\b/.test(s)) return "HTTP_200_JS_SHELL";
  if (/\b(?:empty.catalog|no.candidates)\b/.test(s)) return "HTTP_200_EMPTY_CATALOG";
  if (/\b(?:block.page|challenge.page)\b/.test(s)) return "HTTP_200_BLOCK_PAGE";
  if (/\b(?:redirect.changed|cross.origin.redirect)\b/.test(s)) return "HTTP_REDIRECT_CHANGED";
  if (/\b(?:dns|econnreset|enotfound|fetch.failed|network.error|socket.hang.up)\b/.test(s)) return "SOURCE_TRANSPORT_FAILURE";
  return "UNKNOWN";
}
export function attributeSourceFailures(errors,{query="unknown"}={}) {
  const rows=new Map();
  const list=Array.isArray(errors)?errors:[];
  const normalizedQuery=safeQuery(query);
  for(const entry of list){
    const parent=entry?.sourceId;
    // Legacy aggregated errors had market but only generic sourceId; prefer a
    // concrete merchant id when it is explicitly provided, never infer one.
    const id=sourceId(parent&&parent!=="free-storefronts" ? parent :
      entry?.market??parent??entry?.provider??"unknown");
    const failureClass=classifyFailure(entry);
    const key=id+"\u0000"+failureClass;
    const prior=rows.get(key);
    if(prior) prior.events++;
    else rows.set(key,{query:normalizedQuery,sourceId:id,failureClass,events:1});
  }
  const matrix=[...rows.values()].sort((a,b)=>b.events-a.events||
    a.sourceId.localeCompare(b.sourceId)||a.failureClass.localeCompare(b.failureClass));
  const unknown=matrix.reduce((n,r)=>n+(r.failureClass==="UNKNOWN"?r.events:0),0);
  return {
    query:normalizedQuery,
    eventCount:list.length,
    classifiedEvents:list.length-unknown,
    unknownEvents:unknown,
    matrix,
    // Each row is an observed event group, never a unique merchant count.
    distinctSourceIds:new Set(matrix.map(r=>r.sourceId)).size,
  };
}
export function aggregateFailureMatrices(results){
  const totals=new Map();
  let eventCount=0,classifiedEvents=0,unknownEvents=0;
  for(const result of results){
    eventCount+=result.eventCount;
    classifiedEvents+=result.classifiedEvents;
    unknownEvents+=result.unknownEvents;
    for(const row of result.matrix){
      const k=row.sourceId+"\u0000"+row.failureClass;
      if(!totals.has(k))totals.set(k,{sourceId:row.sourceId,failureClass:row.failureClass,events:0});
      totals.get(k).events+=row.events;
    }
  }
  const matrix=[...totals.values()].sort((a,b)=>b.events-a.events||
    a.sourceId.localeCompare(b.sourceId)||a.failureClass.localeCompare(b.failureClass));
  return {eventCount,classifiedEvents,unknownEvents,matrix,
    distinctSourceIds:new Set(matrix.map(x=>x.sourceId)).size};
}