// Optional PostgreSQL evidence must not become the slowest mandatory
// merchant-search barrier. A pool can queue a query much longer than its SQL
// execution timeout. Bound the customer wait independently of node-postgres.
//
// IMPORTANT: after a timeout, the underlying database task still counts as
// in-flight until it actually settles. Releasing that slot on the customer
// timeout would permit an unbounded pool queue under concurrent traffic.
// Its late result is consumed but NEVER inserted into a completed response.
// This guard neither changes source timestamps nor rewrites offer evidence.
export function createBoundedCatalogRecall({
  read,
  configured,
  budgetMs=2000,
  maxInFlight=2,
}={}){
  if(typeof read!=="function"||typeof configured!=="function")
    throw new TypeError("invalid_catalog_recall_dependency");
  if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>30000)
    throw new RangeError("invalid_catalog_recall_budget");
  if(!Number.isSafeInteger(maxInFlight)||maxInFlight<1||maxInFlight>20)
    throw new RangeError("invalid_catalog_recall_concurrency");

  let inFlight=0;
  const denied=error=>({configured:true,offers:[],error});
  return function boundedCatalogRecall(query,options={}, {signal}={}){
    if(!configured())return Promise.resolve({
      configured:false,offers:[],fetchedRows:0,
    });
    // Abort the shopper's wait immediately, without guessing at the state
    // of another shared database read. No stale evidence is returned.
    if(signal?.aborted)return Promise.resolve(denied("catalog_recall_aborted"));
    if(inFlight>=maxInFlight)
      return Promise.resolve(denied("catalog_recall_busy"));

    inFlight++;
    const work=Promise.resolve().then(()=>read(query,options))
      .then(value=>({kind:"value",value}),()=>({kind:"error"}))
      .finally(()=>{inFlight--;});
    return new Promise(resolve=>{
      let settled=false;
      let timer;
      let onAbort;
      const complete=value=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        if(signal)signal.removeEventListener("abort",onAbort);
        resolve(value);
      };
      onAbort=()=>complete(denied("catalog_recall_aborted"));
      // Timers are for the customer-visible barrier, not a claim that the
      // database wire request was cancelled.
      timer=setTimeout(()=>complete(denied("catalog_recall_budget_exceeded")),budgetMs);
      if(signal){
        signal.addEventListener("abort",onAbort,{once:true});
        if(signal.aborted)onAbort();
      }
      void work.then(outcome=>complete(
        outcome.kind==="value"?outcome.value:denied("catalog_recall_unavailable")
      ));
    });
  };
}
