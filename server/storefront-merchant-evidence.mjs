import {safePdpPhaseSummary} from "./pdp-phase-diagnostics.mjs";
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
const finite=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<600000;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000000?v:null;
const STAGE_COUNTS=new Set(["htmlBytes","cards","fallbackCandidates","directCandidates",
  "directOffers","pdpAttempts","pdpRejected","pdpUnpriced","pdpTimedOut",
  "resolvedOffers","finalOffers","filteredOut"]);
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
    stages,pdpPhases:safePdpPhaseSummary(raw?.pdpPhases),
  };
}
export function summarizeMerchantForensics(spans=[]){
  const buckets=new Map();
  for(const s of (Array.isArray(spans)?spans:[]).slice(0,5000)){
    if(!s||s.storeId==="unknown"||typeof s.storeId!=="string")continue;
    const k=s.storeId;
    if(!buckets.has(k))buckets.set(k,{storeId:k,observations:0,zeroOffers:0,
      rejected:0,offers:0,reportedFailures:0,durations:[],
      stageCoverage:{},stageDurations:{},pdpRuns:[],pdpAttempts:0,
      pdpRejected:0,pdpTimeout:0,pdpPreHeaderFailures:0,
      pdpBudgetCancelled:0,pdpIndependentTimeout:0,
      outcomeClasses:{},tlsNoHeaders:0,pdpCensoredSamples:[]});
    const b=buckets.get(k);b.observations++;
    if(s.status==="zero_offers")b.zeroOffers++;
    if(s.status==="rejected")b.rejected++;
    b.offers+=count(s.verifiedOffers)??0;
    b.reportedFailures+=count(s.failures)??0;
    if(FAILURES.has(s.failureClass)){
      b.outcomeClasses[s.failureClass]=(b.outcomeClasses[s.failureClass]||0)+1;
    }else{
      b.outcomeClasses.UNKNOWN=(b.outcomeClasses.UNKNOWN||0)+1;
    }
    if(n(s.totalMs)!==null)b.durations.push(n(s.totalMs));
    if(s.pdpPhases&&count(s.pdpPhases.attempted)!==null){
      b.pdpRuns.push(s.pdpPhases);
      b.pdpAttempts+=s.pdpPhases.attempted;
      b.pdpRejected+=s.pdpPhases.rejected??0;
      b.pdpTimeout+=s.pdpPhases.timeout??0;
      b.pdpBudgetCancelled+=s.pdpPhases.storeBudgetCancelled??0;
      b.pdpIndependentTimeout+=s.pdpPhases.independentTimeout??0;
      b.pdpPreHeaderFailures+=s.pdpPhases.beforeHeadersFailure??0;
      b.tlsNoHeaders+=s.pdpPhases.tlsReadyWithoutHeadersAtTermination??0;
      const censored=s.pdpPhases.phaseMs?.tlsReadyToCancellationLowerBound;
      if(finite(censored?.p95)&&censored.observations>0)
        b.pdpCensoredSamples.push(censored.p95);
    }
    // The offsets are cumulative from this store's own start. Only subtract
    // adjacent *observed* stages; gaps remain UNKNOWN and never become zero.
    const observed=new Map();
    for(const stage of Array.isArray(s.stages)?s.stages:[])
      if(STAGES.includes(stage?.stage)&&n(stage.atMs)!==null)
        observed.set(stage.stage,n(stage.atMs));
    let previousAt=0,previousObserved=true;
    for(const name of STAGES){
      const at=observed.get(name);
      if(at===undefined){
        previousObserved=false;continue;
      }
      b.stageCoverage[name]=(b.stageCoverage[name]??0)+1;
      if(previousObserved && at>=previousAt){
        if(!b.stageDurations[name])b.stageDurations[name]=[];
        b.stageDurations[name].push(at-previousAt);
      }
      previousAt=at;previousObserved=true;
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
      outcomeClasses:b.outcomeClasses,
      pdpSummary:{
        tracedRuns:b.pdpRuns.length,
        attempts:b.pdpAttempts,rejected:b.pdpRejected,
        timeout:b.pdpTimeout,beforeHeadersFailure:b.pdpPreHeaderFailures,
        storeBudgetCancelled:b.pdpBudgetCancelled,
        independentTimeout:b.pdpIndependentTimeout,
        tlsReadyWithoutHeadersAtTermination:b.tlsNoHeaders,
        // P95 of run-level lower-bound P95s, NOT population PDP latency.
        tlsReadyNoHeadersCensoredRunP95Ms:p(b.pdpCensoredSamples,.95),
        // Quantiles of per-run quantiles, NOT across all PDP attempts.
        phaseRunP95Ms:Object.fromEntries(["dns","tcpHandshake","tlsHandshake",
          "headerWait","bodyRead","productExtraction","priceSelection"].map(name=>[
          name,p(b.pdpRuns.map(r=>r.phaseMs?.[name]?.p95).filter(finite),.95),
        ])),
      },
      stageDurationMs:Object.fromEntries(STAGES.filter(k=>b.stageDurations[k]?.length)
        .map(k=>[k,{samples:b.stageDurations[k].length,
          p50Ms:p(b.stageDurations[k],.5),p95Ms:p(b.stageDurations[k],.95)}])),
      // Normalized per observation. Triage order only, NOT causal probability.
      triageScore:Math.round((p95Ms??0)+
        1000*b.rejected/Math.max(1,b.observations)+
        500*b.zeroOffers/Math.max(1,b.observations)),
    };
  }).sort((a,b)=>b.triageScore-a.triageScore||
    a.storeId.localeCompare(b.storeId)).slice(0,25);
}
