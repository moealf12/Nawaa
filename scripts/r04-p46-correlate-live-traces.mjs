// R04-P46: read-only join of exact, server-generated ephemeral trace IDs.
import {safeSearchTraceProviderId} from "../server/search-critical-path.mjs";
import {safeStorefrontStage,summarizeMerchantForensics} from "../server/storefront-merchant-evidence.mjs";
// No log text, raw query, URL, credential, price, or product title in output.
// Distinguish HTTP requests (possibly cache coalesced) from source generations.
const HEX=/^[a-f0-9]{16}$/;
const INTENT=/^Q(?:0[1-9]|[12][0-9]|3[0-6])$/;
const ms=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<600000?Math.round(n):null;
const cap=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000?n:null;
const key=n=>HEX.test(n||"")?n:null;
const normMode=s=>["fresh","miss","stale","stale-if-error"].includes(s)?s:"unknown";
export function correlateLiveSearchTraces({
  rows=[],httpSpans=[],generations=[],expectedIntents=36,
}={}){
  if(!Array.isArray(rows)||!Array.isArray(httpSpans)||!Array.isArray(generations))
    throw Error("INVALID_R04_P46_TRACE_INPUT");
  const httpByRequest=new Map();
  for(const s of httpSpans.slice(0,256)){
    const id=key(s?.requestId);
    if(!id)continue;
    if(!httpByRequest.has(id))httpByRequest.set(id,[]);
    httpByRequest.get(id).push(s);
  }
  const generationByOwner=new Map(),seenGeneration=new Set();
  for(const g of generations.slice(0,256)){
    const id=key(g?.generationId),owner=key(g?.ownerRequestId);
    if(!id||seenGeneration.has(id))continue;
    seenGeneration.add(id);
    if(!owner)continue;
    if(!generationByOwner.has(owner))generationByOwner.set(owner,[]);
    generationByOwner.get(owner).push(g);
  }
  const used=new Set();
  const observations=[];
  for(const row of rows.slice(0,36)){
    const intentId=row?.id;
    if(!INTENT.test(intentId||"")||used.has(intentId))
      throw Error("INVALID_R04_P46_INTENT");
    used.add(intentId);
    const requestId=key(row?.requestTraceId);
    const hs=requestId?httpByRequest.get(requestId)||[]:[];
    const gs=requestId?generationByOwner.get(requestId)||[]:[];
    const span=hs.length===1?hs[0]:null;
    const generation=gs.length===1?gs[0]:null;
    const coalesced=span?.coalescedOnEntry===true;
    const mode=normMode(span?.cacheMode);
    let linkage="UNKNOWN";
    if(!requestId)linkage="REQUEST_ID_MISSING";
    else if(hs.length!==1)linkage=hs.length?"HTTP_EVENT_AMBIGUOUS":"HTTP_EVENT_MISSING";
    else if(coalesced)linkage="COALESCED_REFRESH_NOT_OWNER";
    else if(gs.length>1)linkage="GENERATION_AMBIGUOUS";
    else if(generation)linkage="GENERATION_OWNER_OBSERVED";
    else if(mode==="fresh")linkage="CACHE_HIT_NO_GENERATION";
    else linkage="GENERATION_NOT_OBSERVED";
    observations.push({
      id:intentId,requestId,linkage,
      http:span?{
        totalHttpMs:ms(span.totalHttpMs),
        cacheLookupMs:ms(span.cacheLookupMs),postCacheMs:ms(span.postCacheMs),
        afterPreparedMs:ms(span.afterPreparedMs),cacheMode:mode,coalescedOnEntry:coalesced,
        status:["finished","client_closed"].includes(span.status)?span.status:"unknown",
      }:null,
      generation:generation&&!coalesced&&span?{
        generationId:key(generation.generationId),
        phases:{
          primaryAcquisitionMs:ms(generation.phases?.primaryAcquisitionMs),
          preSelectionMs:ms(generation.phases?.preSelectionMs),
          finalizationMs:ms(generation.phases?.finalizationMs),
          pipelineMs:ms(generation.phases?.pipelineMs),
        },
        phaseAccounting:generation.phaseAccounting==="CONSISTENT"?"CONSISTENT":"UNKNOWN_OR_INCONSISTENT",
        dominantStages:(Array.isArray(generation.dominantStages)?generation.dominantStages:[])
          .filter(x=>["primary_acquisition","pre_selection","finalization"].includes(x)).slice(0,3),
        lastBarrierCandidates:(Array.isArray(generation.lastBarrierCandidates)?
          generation.lastBarrierCandidates:[]).filter(x=>
          ["amazon-sa","provider-pass","meilisearch","persisted"].includes(x)).slice(0,4),
        providerSpans:(Array.isArray(generation.providerSpans)?generation.providerSpans:[])
          .slice(0,24).map(p=>({
            sourceId:safeSearchTraceProviderId(p?.sourceId),
            pass:p?.pass==="fallback"?"fallback":"primary",
            wallMs:ms(p?.wallMs),completedFromSearchStartMs:ms(p?.completedFromSearchStartMs),
            callbackQueueMs:ms(p?.callbackQueueMs),
            offers:cap(p?.offers),errors:cap(p?.errors),
          })),
        providerEventsDropped:cap(generation.providerEventsDropped),
        storefrontSpans:(Array.isArray(generation.storefrontSpans)?
          generation.storefrontSpans:[]).slice(0,64).map(m=>({
            storeId:typeof m?.storeId==="string"&&/^[a-z0-9][a-z0-9-]{1,79}$/.test(m.storeId)?
              m.storeId:"unknown",
            pass:m?.pass==="fallback"?"fallback":"primary",
            status:["with_offers","zero_offers","rejected"].includes(m?.status)?
              m.status:"unknown",
            totalMs:ms(m?.totalMs),candidates:cap(m?.candidates),
            verifiedOffers:cap(m?.verifiedOffers),failures:cap(m?.failures),
            failureClass:["HTTP_403_ACCESS_DENIED","HTTP_429_RATE_LIMITED","HTTP_TIMEOUT",
              "HTTP_5XX_SOURCE_FAILURE","HTTP_200_BLOCK_PAGE","HTTP_200_JS_SHELL",
              "SOURCE_ACCESS_DENIED_COOLDOWN","SOURCE_RATE_LIMIT_COOLDOWN",
              "SOURCE_TRANSPORT_FAILURE","NO_VERIFIED_STRUCTURED_PRICE_PDP",
              "HTTP_404_RESOURCE_NOT_FOUND","HTTP_ABORTED"].includes(m?.failureClass)?
              m.failureClass:"UNKNOWN",
            stages:(Array.isArray(m?.stages)?m.stages:[]).slice(0,6)
              .map(x=>safeStorefrontStage(x?.stage,x?.atMs,x?.counts)).filter(Boolean),
          })),
        storefrontEventsDropped:cap(generation.storefrontEventsDropped),
        stages:Object.fromEntries(["providerRaw","primaryAssessed","primaryRelevant",
          "primaryMerchants","amazonRaw","amazonValidated","indexRaw",
          "catalogRaw","beforeCanonical","afterCanonical","rescoredAssessed",
          "rescoredAccepted","afterAdmission",
          "selected","errorEvents"].map(k=>[k,cap(generation.stages?.[k])])),
        deadlineExceeded:generation.deadlineExceeded===true,
        rootCause:"UNDETERMINED",
      }:null,
    });
  }
  const counts={};
  for(const o of observations)counts[o.linkage]=(counts[o.linkage]||0)+1;
  const linked=observations.filter(o=>o.linkage==="GENERATION_OWNER_OBSERVED"&&o.generation);
  const p=(values,q)=>{
    const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
    return sorted.length?sorted[Math.max(0,Math.ceil(q*sorted.length)-1)]:null;
  };
  const phaseValues={
    primaryAcquisition:linked.map(o=>o.generation.phases.primaryAcquisitionMs),
    preSelection:linked.map(o=>o.generation.phases.preSelectionMs),
    finalization:linked.map(o=>o.generation.phases.finalizationMs),
  };
  const phaseSample=Object.fromEntries(Object.entries(phaseValues).map(([name,values])=>
    [name,{observations:values.filter(Number.isFinite).length,p50Ms:p(values,.5),p95Ms:p(values,.95)}]));
  const dominantCounts={},lastBarrierCounts={},providers=new Map();
  for(const o of linked){
    for(const stage of o.generation.dominantStages)
      dominantCounts[stage]=(dominantCounts[stage]||0)+1;
    for(const barrier of o.generation.lastBarrierCandidates)
      lastBarrierCounts[barrier]=(lastBarrierCounts[barrier]||0)+1;
    for(const span of o.generation.providerSpans){
      if(span.sourceId==="unknown")continue;
      const values=providers.get(span.sourceId)||{wall:[],errors:0,observations:0};
      if(span.wallMs!==null)values.wall.push(span.wallMs);
      values.errors+=span.errors||0;
      values.observations++;
      providers.set(span.sourceId,values);
    }
  }
  const slowProviderSamples=[...providers.entries()].map(([sourceId,data])=>({
    sourceId,observations:data.observations,
    wallP50Ms:p(data.wall,.5),wallP95Ms:p(data.wall,.95),errorEventsObserved:data.errors,
  })).sort((a,b)=>(b.wallP95Ms??-1)-(a.wallP95Ms??-1)||
    a.sourceId.localeCompare(b.sourceId)).slice(0,12);
  const allStoreSpans=linked.flatMap(o=>o.generation.storefrontSpans||[]);
  const merchantForensics=summarizeMerchantForensics(allStoreSpans);
  const measured={
    linkedGenerationCount:linked.length,
    merchantStageEventCount:allStoreSpans.length,merchantForensics,
    merchantTraceOverflow:linked.reduce((sum,o)=>
      sum+(o.generation.storefrontEventsDropped??0),0),
    phaseSample,dominantStageCounts:dominantCounts,
    lastObservedBarrierCounts:lastBarrierCounts,
    slowProviderSamples,
    caveat:"ranked_wall_times_and_last_settled_barriers_are_not_causal_root_attribution",
  };
  return {
    schemaVersion:"nawaa.r04.p46.correlated-live.v1",
    classification:"REAL_MERCHANT_CANDIDATE_OBSERVATIONS_NOT_RENDER_CAUSAL_AB",
    expectedIntents,observedIntents:observations.length,
    receivedHttpEvents:httpSpans.length,receivedGenerationEvents:generations.length,
    association:counts,measured,observations,
    limitations:[
      "Cache coalesced request is never misidentified as the generation owner.",
      "An owner context may be superseded after cache invalidation; lineage is observational.",
      "No stage is certified as root cause merely because it finished last.",
      "Merchant-level traces are bounded; overflow is explicit and not a zero error.",
      "A missing stage indicates unknown or early exit, never zero time or out of stock.",
      "Disposable candidate has no production DB/index credentials and is not Render performance.",
    ],
  };
}
