import {recordOffer} from "../persistence.mjs";
function toRecord(offer,query){return {sourceUrl:offer.productUrl,title:offer.title,productPrice:offer.price,currency:offer.currency,sourceName:"extra-sa",merchant:"eXtra Saudi",merchantCountryCode:"SA",brand:offer.brand,sku:offer.sku,condition:offer.condition||"new",availability:offer.availability,imageUrl:offer.imageUrl,observedAt:offer.observedAt,query,healthStatus:"healthy",sourceProductId:offer.sourceProductId,variant:offer.variant,specs:offer.specs}}
export async function limitedIngest({offers=[],query="canary",maxOffers=200,record=recordOffer}={}){
 const sample=offers.slice(0,Math.max(0,Math.min(200,maxOffers))),results=[];let saved=0,failed=0;
 for(const offer of sample){try{const result=await record(toRecord(offer,query));saved++;results.push({sourceProductId:offer.sourceProductId,recorded:result?.recorded===true})}catch(error){failed++;results.push({sourceProductId:offer.sourceProductId,recorded:false,error:error?.message||String(error)})}}
 return {passed:sample.length>0&&failed===0&&saved===sample.length,attempted:sample.length,saved,failed,limited:true,results};
}
