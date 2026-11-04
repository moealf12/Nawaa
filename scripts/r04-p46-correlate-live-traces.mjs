// R04-P46: read-only join of exact, server-generated ephemeral trace IDs.
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
            sourceId:/^[a-z0-9][a-z0-9:_-]{1,55}$/.test(p?.sourceId||"")?p.sourceId:"unknown",
            pass:p?.pass==="fallback"?"fallback":"primary",
            wallMs:ms(p?.wallMs),completedFromSearchStartMs:ms(p?.completedFromSearchStartMs),
            callbackQueueMs:ms(p?.callbackQueueMs),
            offers:cap(p?.offers),errors:cap(p?.errors),
          })),
        providerEventsDropped:cap(generation.providerEventsDropped),
        stages:Object.fromEntries(["providerRaw","amazonRaw","amazonValidated","indexRaw",
          "catalogRaw","beforeCanonical","afterCanonical","rescoredAccepted","afterAdmission",
          "selected","errorEvents"].map(k=>[k,cap(generation.stages?.[k])])),
        deadlineExceeded:generation.deadlineExceeded===true,
        rootCause:"UNDETERMINED",
      }:null,
    });
  }
  const counts={};
  for(const o of observations)counts[o.linkage]=(counts[o.linkage]||0)+1;
  return {
    schemaVersion:"nawaa.r04.p46.correlated-live.v1",
    classification:"REAL_MERCHANT_CANDIDATE_OBSERVATIONS_NOT_RENDER_CAUSAL_AB",
    expectedIntents,observedIntents:observations.length,
    receivedHttpEvents:httpSpans.length,receivedGenerationEvents:generations.length,
    association:counts,observations,
    limitations:[
      "Cache coalesced request is never misidentified as the generation owner.",
      "An owner context may be superseded after cache invalidation; lineage is observational.",
      "No stage is certified as root cause merely because it finished last.",
      "Disposable candidate has no production DB/index credentials and is not Render performance.",
    ],
  };
}
