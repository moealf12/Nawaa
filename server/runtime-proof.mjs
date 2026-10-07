import {searchExtraAll} from "./adapters/sa/extra.mjs";
import {limitedIngest} from "./source-inspector/limited-ingestion.mjs";
import {searchPersistedOffers} from "./persistence.mjs";
export async function proveExtraPersistence({query="iPhone",maxOffers=50}={}){
 const live=await searchExtraAll(query,{maxResults:maxOffers});
 const ingest=await limitedIngest({offers:live.offers,query,maxOffers});
 if(!ingest.passed) return {passed:false,stage:"ingest",liveOffers:live.offers.length,ingest};
 const persisted=await searchPersistedOffers(query,{limit:Math.max(100,maxOffers*2),maxAgeHours:1});
 const extra=persisted.offers.filter(o=>o.sourceName==="extra-sa"||o.merchant==="eXtra Saudi");
 return {passed:extra.length>0,stage:extra.length>0?"read-back":"read-back-empty",liveOffers:live.offers.length,ingest:{passed:ingest.passed,attempted:ingest.attempted,saved:ingest.saved,failed:ingest.failed},persistedExtraOffers:extra.length};
}
