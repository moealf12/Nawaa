// R04-P46: bounded correlation of one JSON search refresh, not a shopper profile.
// No queries, URLs, prices, raw errors, IP addresses or persistent identifiers.
// The producing cache generation and each waiting HTTP request are distinct.
import {AsyncLocalStorage} from "node:async_hooks";
import {randomBytes} from "node:crypto";

const context=new AsyncLocalStorage();
export const SEARCH_TRACE_ENABLED=process.env.NAWAA_SEARCH_DIAGNOSTIC_TRACE==="1";
const ID=/^[0-9a-f]{16}$/;
const finite=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<600000;
const ms=n=>finite(n)?Math.round(n):null;
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000?n:null;
const PROVIDERS=new Set([
  "extra-unbxd","jarir-direct","virgin-ae","sharafdg-algolia",
  "swarovski-direct","amazon-creators","free-storefronts",
  "carrefour-ksa","noon-catalog","ebay","shopify",
]);
export function safeSearchTraceProviderId(n){
  return typeof n==="string"&&PROVIDERS.has(n)?n:"unknown";
}
const components=new Set(["amazon-sa","provider-pass","meilisearch","persisted"]);
const FROZEN_PROVIDER_CAP=24;
export function newSearchDiagnosticId(){return randomBytes(8).toString("hex");}
export function withSearchDiagnosticOwner(requestId,fn){
  if(!SEARCH_TRACE_ENABLED)return fn();
  if(!ID.test(requestId)||typeof fn!=="function")throw Error("INVALID_SEARCH_TRACE_OWNER");
  return context.run({requestId},fn);
}
export function currentSearchDiagnosticOwner(){
  return SEARCH_TRACE_ENABLED?context.getStore()?.requestId??null:null;
}
export function searchCriticalPathEvidence({
  generationId,ownerRequestId=null,
  primaryAcquiredMs,preSelectionMs,finalizationMs,totalMs,
  providerTimings=[],primaryComponents=[],offerStages={},
  deadlineExceeded=false,fallbackUsed=false,providerEventsDropped=0,
}={}){
  if(!ID.test(generationId||""))throw Error("INVALID_SEARCH_TRACE_GENERATION");
  const time={
    primaryAcquisitionMs:ms(primaryAcquiredMs),
    preSelectionMs:ms(preSelectionMs),
    finalizationMs:ms(finalizationMs),
    pipelineMs:ms(totalMs),
  };
  const intervals=[time.primaryAcquisitionMs,time.preSelectionMs,time.finalizationMs];
  const measured=intervals.every(Number.isInteger)&&time.pipelineMs!==null;
  const elapsedSum=measured?intervals.reduce((a,b)=>a+b,0):null;
  const phaseAccounting=measured&&Math.abs(elapsedSum-time.pipelineMs)<=3
    ?"CONSISTENT":"UNKNOWN_OR_INCONSISTENT";
  const stageNames=["primary_acquisition","pre_selection","finalization"];
  const longest=measured&&phaseAccounting==="CONSISTENT"?
    Math.max(...intervals):null;
  const dominantStages=longest===null?[]:stageNames.filter((_,i)=>intervals[i]>=longest-3);
  // The latest settled primary barrier is a last observed completion,
  // NOT proof that this barrier is the originating cause (deadlines can settle early).
  const barriers=(Array.isArray(primaryComponents)?primaryComponents:[]).slice(0,4)
    .filter(b=>components.has(b?.component)).map(b=>({
      component:b.component,settledAtMs:ms(b.settledAtMs),
      failed:b.failed===true,
    }));
  const validBarriers=barriers.filter(x=>x.settledAtMs!==null);
  const last=validBarriers.length?Math.max(...validBarriers.map(b=>b.settledAtMs)):null;
  const lastBarrierCandidates=last===null?[]:validBarriers
    .filter(b=>b.settledAtMs>=last-3).map(b=>b.component).sort();
  const providerSpans=(Array.isArray(providerTimings)?providerTimings:[])
    .slice(0,FROZEN_PROVIDER_CAP).map(item=>({
      sourceId:safeSearchTraceProviderId(item?.sourceId),
      pass:item?.pass==="fallback"?"fallback":"primary",
      wallMs:ms(item?.providerWallMs),
      callbackQueueMs:ms(item?.queueMs),
      completedFromSearchStartMs:ms(item?.completedFromSearchStartMs),
      offers:nonnegative(item?.offers),
      errors:nonnegative(item?.errors),
    }));
  // A count at a stage boundary is NOT an exact sum of merchant offers:
  // deduplication, interleaved index recall and fanout make the stages non-additive.
  const stageLabels=[
    "providerRaw","amazonRaw","amazonValidated","indexRaw","catalogRaw",
    "beforeCanonical","afterCanonical","rescoredAccepted","afterAdmission",
    "selected","errorEvents",
  ];
  const stages=Object.fromEntries(stageLabels.map(k=>[k,nonnegative(offerStages?.[k])]));
  return {
    schemaVersion:"nawaa.r04.p46.critical-path.v1",
    classification:"CORRELATED_GENERATION_OBSERVATION_NOT_CAUSAL_PROOF",
    generationId,ownerRequestId:ID.test(ownerRequestId||"")?ownerRequestId:null,
    phases:time,phaseAccounting,dominantStages,
    barriers,lastBarrierCandidates,
    providerSpans,
    providerEventsDropped:nonnegative(providerEventsDropped),
    stages,deadlineExceeded:deadlineExceeded===true,
    fallbackUsed:fallbackUsed===true,
    rootCause:"UNDETERMINED",
    caveats:[
      "barrier_last_settled_is_not_a_causal_root",
      "provider_wall_time_includes_async_waits_not_per_provider_cpu",
      "merchant_offer_stages_are_non_additive",
      "cache_coalesced_http_waiters_are_not_generation_owners",
    ],
  };
}
