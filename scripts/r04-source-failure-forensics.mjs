// R04 live evidence: low-cardinality, non-sensitive source failure attribution.
// Never emit source error strings, credential-bearing URLs, queries, SKUs, or
// arbitrary untrusted failureClass/sourceId values into CI report summaries.
const MAX_BUCKETS=32;
const SAFE_FAILURE_CLASSES=new Set([
  "HTTP_403_ACCESS_DENIED","HTTP_404_RESOURCE_NOT_FOUND",
  "HTTP_410_RESOURCE_GONE","HTTP_429_RATE_LIMITED",
  "HTTP_5XX_SOURCE_FAILURE","HTTP_TIMEOUT","HTTP_ABORTED",
  "HTTP_200_BLOCK_PAGE","HTTP_200_JS_SHELL","HTTP_200_EMPTY_CATALOG",
  "HTTP_REDIRECT_CHANGED","PRODUCT_IDENTITY_MISMATCH",
  "EXTRACTION_FAILURE","CATALOG_RESULT_NOT_FOUND",
  "SOURCE_TRANSPORT_FAILURE","PRICE_EVIDENCE_INCOMPLETE",
  "NO_VERIFIED_STRUCTURED_PRICE_PDP",
  "SOURCE_ACCESS_DENIED_COOLDOWN","SOURCE_RATE_LIMIT_COOLDOWN","UNKNOWN",
]);
const safeId=value=>typeof value==="string"&&/^[a-z0-9][a-z0-9:_-]{1,79}$/i.test(value)
  ?value.toLowerCase():null;
const safeClass=value=>SAFE_FAILURE_CLASSES.has(value)?value:"UNCLASSIFIED";
function compact(map,reported,classified,preexistingOther=0){
  const sorted=[...map.entries()].map(([key,count])=>{
    const [sourceId,failureClass]=key.split("|");
    return {sourceId,failureClass,count};
  }).sort((a,b)=>b.count-a.count||a.sourceId.localeCompare(b.sourceId)||
    a.failureClass.localeCompare(b.failureClass));
  const buckets=sorted.slice(0,MAX_BUCKETS);
  return {
    reported,classified,
    otherEvents:preexistingOther+sorted.slice(MAX_BUCKETS).reduce((n,x)=>n+x.count,0),
    buckets,
  };
}
export function aggregateSourceErrorEvidence(errors){
  if(!Array.isArray(errors)||errors.length===0)
    return {reported:0,classified:0,otherEvents:0,buckets:[]};
  const counts=new Map();
  for(const issue of errors){
    const sourceId=safeId(issue?.market)||safeId(issue?.sourceId)||
      safeId(issue?.provider)||"unknown";
    const failureClass=safeClass(issue?.failureClass);
    const key=sourceId+"|"+failureClass;
    counts.set(key,(counts.get(key)||0)+1);
  }
  return compact(counts,errors.length,errors.length);
}
export function mergeSourceErrorEvidence(summaries=[]){
  const counts=new Map();
  let reported=0,classified=0,other=0;
  for(const row of Array.isArray(summaries)?summaries:[]){
    if(!row||typeof row!=="object")continue;
    reported+=Number.isSafeInteger(row.reported)&&row.reported>0?row.reported:0;
    classified+=Number.isSafeInteger(row.classified)&&row.classified>0?row.classified:0;
    other+=Number.isSafeInteger(row.otherEvents)&&row.otherEvents>0?row.otherEvents:0;
    for(const bucket of Array.isArray(row.buckets)?row.buckets:[]){
      const id=safeId(bucket?.sourceId),klass=safeClass(bucket?.failureClass);
      const count=bucket?.count;
      if(!id||!Number.isSafeInteger(count)||count<=0)continue;
      const key=id+"|"+klass;
      counts.set(key,(counts.get(key)||0)+count);
    }
  }
  return compact(counts,reported,classified,other);
}
