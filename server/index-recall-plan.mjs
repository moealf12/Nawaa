// R04 P2: bounded, additional *fresh index* recall. This is not a live
// merchant fetch, and indexed prices never acquire a new observation time.
// Wave 0 consumes the existing first 80 candidates. Expansion waves access
// non-overlapping index positions up to Meilisearch's configured total-hit cap.
import {isExcludedMerchantSource} from "../src/source-registry.mjs";

export const INDEX_RECALL_BUDGET=1_000;
export const INDEX_RECALL_TIMEOUT_MS=900;
export const INDEX_OBSERVATION_TTL_MS=45_000;

export function indexRecallPlan(depth){
  if(depth===1)return {offset:80,limit:420};
  if(depth===2)return {offset:500,limit:500};
  throw new RangeError("invalid_index_recall_depth");
}
export function validateIndexPage({offset=0,limit=80}={}){
  if(!Number.isSafeInteger(offset)||offset<0||offset>=INDEX_RECALL_BUDGET||
     !Number.isSafeInteger(limit)||limit<1||limit>500||
     offset+limit>INDEX_RECALL_BUDGET)throw new RangeError("invalid_index_page");
  return {offset,limit};
}
export function filterFreshIndexedHits(hits,{now=Date.now(),freshMs=INDEX_OBSERVATION_TTL_MS}={}){
  if(!Array.isArray(hits)||!Number.isFinite(now)||!Number.isSafeInteger(freshMs)||freshMs<0)
    throw new TypeError("invalid_index_evidence");
  const offers=[];let rejectedStale=0,rejectedExcluded=0,rejectedMalformed=0;
  for(const hit of hits){
    if(!hit||typeof hit!=="object"||typeof hit.title!=="string"||
        !hit.title.trim()||typeof hit.sourceUrl!=="string"||!hit.sourceUrl.trim()){
      rejectedMalformed++;continue;
    }
    if(isExcludedMerchantSource({name:hit.merchant,baseUrl:hit.sourceUrl})){
      rejectedExcluded++;continue;
    }
    const when=typeof hit.observedAt==="string"?Date.parse(hit.observedAt):NaN;
    const age=now-when;
    if(!Number.isFinite(when)||age < -60_000||age>freshMs){
      rejectedStale++;continue;
    }
    offers.push({...hit,
      // Query-dependent historical scores must never be trusted on replay.
      exactMatch:false,matchConfidence:0,dataKind:"indexed"});
  }
  return {offers,rejectedStale,rejectedExcluded,rejectedMalformed};
}
export function compactIndexRecallEvidence(result,{offset,limit}={}){
  return {
    configured:result?.configured===true,
    offset,limit,
    fetchedHits:Number.isSafeInteger(result?.fetchedHits)?result.fetchedHits:0,
    acceptedFresh:Number.isSafeInteger(result?.offers?.length)?result.offers.length:0,
    rejectedStale:Number.isSafeInteger(result?.rejectedStale)?result.rejectedStale:0,
    rejectedExcluded:Number.isSafeInteger(result?.rejectedExcluded)?result.rejectedExcluded:0,
    rejectedMalformed:Number.isSafeInteger(result?.rejectedMalformed)?result.rejectedMalformed:0,
    // Meilisearch estimatedTotalHits is only a search estimate, never stock.
    estimatedHits:Number.isSafeInteger(result?.estimatedTotalHits)?result.estimatedTotalHits:null,
    status:result?.error?"failed":result?.configured===true?"observed":"unconfigured",
    error:result?.error?"index_recall_unavailable":null,
    sourceObservationOnly:true,
  };
}
