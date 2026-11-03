// Honest bounded source-catalog read diagnostics. A query with no committed
// rows is not evidence that a merchant is out of stock.
export function catalogRecallPlan(depth){
  if(depth===0)return {offset:0,limit:120};
  if(depth===1)return {offset:120,limit:380};
  if(depth===2)return {offset:500,limit:500};
  throw new RangeError("invalid_catalog_recall_depth");
}
export function summarizeCatalogRecall(result,{offset,limit}={}){
  return {
    configured:result?.configured===true,
    offset,limit,
    fetchedRows:Number.isSafeInteger(result?.fetchedRows)?result.fetchedRows:0,
    acceptedFresh:Array.isArray(result?.offers)?result.offers.length:0,
    rejectedStale:Number.isSafeInteger(result?.rejectedStale)?result.rejectedStale:0,
    status:result?.error?"failed":result?.configured===true?"observed":"unconfigured",
    error:result?.error?"catalog_recall_unavailable":null,
    sourceObservationOnly:true,
    exhaustive:false,
  };
}
