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

// A catalog read is optional for merchant acquisition, but a configured failed
// recall must not be certified as a complete source+catalog customer snapshot
// or enter the strict search cache. Do not relabel database failures as
// merchant transport failures; sourceFailures must remain source-owned.
export function guardCatalogRecallCompleteness(coverage={}) {
  const catalog=coverage?.catalogRecall;
  const inconsistent= catalog != null && (
    typeof catalog!=="object" || Array.isArray(catalog) ||
    (catalog.configured===true &&
      (catalog.status!=="observed" || catalog.error!=null)) ||
    (catalog.configured===false && catalog.status==="failed")
  );
  const incomplete=coverage?.partial===true || Boolean(inconsistent);
  return {...coverage,
    partial:incomplete,
    complete:coverage?.complete===true && !incomplete,
  };
}

// Internal slow-pipeline telemetry uses only bounded constant classes. Never
// echo driver messages, merchant URLs, request text, SKU or DATABASE_URL.
// The public catalogRecall.error remains catalog_recall_unavailable for schema
// compatibility; these classes are diagnostics, not replacement offer truth.
export function catalogRecallFailureClass(result) {
  if(!result?.error)return null;
  switch(result.error) {
    case "catalog_recall_busy": return "busy";
    case "catalog_recall_budget_exceeded": return "budget_exceeded";
    case "catalog_recall_aborted": return "aborted";
    case "catalog_deadline_exceeded": return "request_deadline";
    default: return "query_failure";
  }
}
