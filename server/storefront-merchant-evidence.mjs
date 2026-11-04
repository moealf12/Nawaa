// R04-P47: opt-in storefront-scoped evidence; no merchant network traffic or
// customer result changes. Strict allowlist of fields, bounded and redacted.
const STAGES=Object.freeze([
  "html_complete","cards_parsed","fallback_complete",
  "direct_admitted","pdp_resolved","intent_filtered",
]);
const STATES=new Set(["with_offers","zero_offers","rejected"]);
const FAILURES=new Set([
  "HTTP_403_ACCESS_DENIED","HTTP_429_RATE_LIMITED","HTTP_TIMEOUT",
  "HTTP_5XX_SOURCE_FAILURE","HTTP_200_BLOCK_PAGE","HTTP_200_JS_SHELL",
  "SOURCE_ACCESS_DENIED_COOLDOWN","SOURCE_RATE_LIMIT_COOLDOWN",
  "SOURCE_TRANSPORT_FAILURE","NO_VERIFIED_STRUCTURED_PRICE_PDP",
  "HTTP_404_RESOURCE_NOT_FOUND","HTTP_ABORTED","UNKNOWN",
]);
const n=v=>Number.isFinite(v)&&v>=0&&v<600000?Math.round(v):null;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:null;
const STAGE_COUNTS=new Set(["htmlBytes","cards","fallbackCandidates","directCandidates",
  "directOffers","pdpAttempts","resolvedOffers","finalOffers","filteredOut"]);
export function safeStorefrontStage(stage,elapsedMs,counts={}){
  if(!STAGES.includes(stage))return null;
  const values={};
  if(counts&&typeof counts==="object"&&!Array.isArray(counts))
    for(const [key,value] of Object.entries(counts)){
      if(STAGE_COUNTS.has(key)&&count(value)!==null)values[key]=value;
    }
  return {stage,atMs:n(elapsedMs),counts:values};
}
export function safeStorefrontOutcome(raw,{knownStoreIds}={}){
  const known=knownStoreIds instanceof Set?knownStoreIds:new Set(knownStoreIds||[]);
  const storeId=typeof raw?.storeId==="string"&&known.has(raw.storeId)?raw.storeId:"unknown";
  const stages=[];
  const used=new Set();
  for(const value of Array.isArray(raw?.stages)?raw.stages.slice(0,12):[]){
    const stage=safeStorefrontStage(value?.stage,value?.atMs,value?.counts);
    if(stage&&!used.has(stage.stage)){used.add(stage.stage);stages.push(stage);}
  }
  return {
    storeId,pass:raw?.pass==="fallback"?"fallback":"primary",
    status:STATES.has(raw?.status)?raw.status:"unknown",
    totalMs:n(raw?.totalMs),
    candidates:count(raw?.candidates),
    verifiedOffers:count(raw?.verifiedOffers),
    failures:count(raw?.failures),
    failureClass:FAILURES.has(raw?.failureClass)?raw.failureClass:"UNKNOWN",
    stages,
  };
}
export function summarizeMerchantForensics(spans=[]){
  const buckets=new Map();
  for(const s of (Array.isArray(spans)?spans:[]).slice(0,5000)){
    if(!s||s.storeId==="unknown"||typeof s.storeId!=="string")continue;
    const k=s.storeId;
    if(!buckets.has(k))buckets.set(k,{storeId:k,observations:0,zeroOffers:0,
      rejected:0,offers:0,reportedFailures:0,durations:[],stageCoverage:{}});
    const b=buckets.get(k);b.observations++;
    if(s.status==="zero_offers")b.zeroOffers++;
    if(s.status==="rejected")b.rejected++;
    b.offers+=count(s.verifiedOffers)??0;
    b.reportedFailures+=count(s.failures)??0;
    if(n(s.totalMs)!==null)b.durations.push(n(s.totalMs));
    for(const stage of Array.isArray(s.stages)?s.stages:[]){
      if(STAGES.includes(stage?.stage))b.stageCoverage[stage.stage]=
        (b.stageCoverage[stage.stage]??0)+1;
    }
  }
  const p=(a,q)=>{const s=a.sort((x,y)=>x-y);return s.length?
    s[Math.max(0,Math.ceil(q*s.length)-1)]:null;};
  return [...buckets.values()].map(b=>{
    const p50Ms=p(b.durations,.5),p95Ms=p(b.durations,.95);
    return {storeId:b.storeId,observations:b.observations,
      zeroOffers:b.zeroOffers,rejected:b.rejected,
      verifiedOffers:b.offers,reportedFailures:b.reportedFailures,
      p50Ms,p95Ms,stageCoverage:b.stageCoverage,
      // Triage order only; no causal or inventory inference.
      triageScore:(p95Ms??0)+1000*b.rejected+500*b.zeroOffers,
    };
  }).sort((a,b)=>b.triageScore-a.triageScore||
    a.storeId.localeCompare(b.storeId)).slice(0,25);
}
