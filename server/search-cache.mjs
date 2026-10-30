// Cache admission is intentionally separate from returning validated offers.
// A partial fetch can help the requesting shopper while never becoming a
// canonical fresh snapshot that suppresses subsequent source acquisition.
export function classifySearchCacheAdmission(result,{requireExplicitComplete=false}={}){
  const offers=Array.isArray(result?.offers)?result.offers:[];
  const errors=Array.isArray(result?.errors)?result.errors:[];
  const coverage=result?.coverage && typeof result.coverage==="object" &&
    !Array.isArray(result.coverage)?result.coverage:null;
  const deny=(completeness,reason)=>({cacheable:false,completeness,reason});
  if(!offers.length)return deny("empty","no_offers");
  if(!coverage){
    if(requireExplicitComplete)return deny("unknown","coverage_missing");
    if(errors.length)return deny("partial","source_errors");
    return {cacheable:true,completeness:"complete",reason:"legacy_clean_result"};
  }
  // Missing optional counters mean the provider did not observe them. Explicit
  // malformed counters are NOT equivalent to 0 and must fail closed.
  const counter=(obj,key)=>{
    if(!(key in obj))return 0;
    const n=obj[key];
    return typeof n==="number" && Number.isSafeInteger(n) && n>=0 ? n : null;
  };
  const pending=counter(coverage,"providersPending");
  const failures=coverage.sourceFailures;
  const errorsReported=failures===undefined?0:
    failures && typeof failures==="object" && !Array.isArray(failures)
      ?counter(failures,"errorsReported"):null;
  if(pending===null||errorsReported===null)return deny("unknown","coverage_invalid");
  const complete=coverage.complete===true;
  const partial=coverage.partial===true;
  const deadline=coverage.deadlineExceeded===true;
  const hasErrors=errors.length>0||errorsReported>0;
  if(complete&&(partial||deadline||pending>0||hasErrors))
    return deny("unknown","coverage_conflict");
  if(deadline)return deny("partial","deadline_exceeded");
  if(pending>0)return deny("partial","providers_pending");
  if(partial)return deny("partial","coverage_partial");
  if(coverage.complete===false)return deny("partial","coverage_incomplete");
  if(hasErrors)return deny("partial","source_errors");
  if(complete && coverage.partial!==false)return deny("unknown","coverage_unproven");
  if(coverage.deadlineExceeded!==undefined && typeof coverage.deadlineExceeded!=="boolean")
    return deny("unknown","coverage_invalid");
  if(coverage.partial!==undefined && typeof coverage.partial!=="boolean")
    return deny("unknown","coverage_invalid");
  if(coverage.complete!==undefined && typeof coverage.complete!=="boolean")
    return deny("unknown","coverage_invalid");
  if(!complete)return deny("unknown","coverage_unproven");
  return {cacheable:true,completeness:"complete",reason:"complete_result"};
}

// Stale-while-revalidate search snapshots. Fresh hits return immediately; stale
// hits are served immediately while one coalesced refresh runs in background.
export function createSearchCache(search, {
  ttl = 45000,
  staleTtl = 5 * 60 * 1000,
  maxEntries = 80,
  now = Date.now,
  classifyAdmission = classifySearchCacheAdmission,
} = {}) {
  if(typeof search!=="function"||typeof now!=="function"||typeof classifyAdmission!=="function")
    throw new TypeError("invalid_search_cache_dependency");
  const entries = new Map();
  const pending = new Map();
  const refreshInfo=new WeakMap();
  const invalidators=new WeakMap();
  const refreshControllers=new WeakMap();
  let generation = 0;

  const clone = (value) => structuredClone(value);
  const cacheMeta = (mode, ageMs, {completeness=null,refreshing=mode==="stale"}={}) => ({
    hit: mode !== "miss",
    mode,
    stale: mode === "stale" || mode === "stale-if-error",
    refreshing:Boolean(refreshing),
    completeness,
    ageMs,
    ttlMs: ttl,
    staleTtlMs: staleTtl,
  });

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  // Each generation owns exactly one refresh per key. On invalidation, the
  // waiting shoppers switch to the *same newly started* generation without
  // waiting for the obsolete merchant acquisition to settle first.
  function startRefresh(key) {
    if (pending.has(key)) return pending.get(key);
    const trace={refreshReplays:0,lastInvalidationReason:null,
      cacheAdmission:null,cacheAdmissionReason:null,completeness:null};
    const controller=new AbortController();
    const startedGeneration=generation;
    let invalidate;
    const invalidated=new Promise(resolve=>{invalidate=resolve;});
    const task=Promise.resolve().then(async()=>{
      // Handle late failures from an abandoned acquisition, even after its
      // subscribers switched generations. Do not leak an unhandled rejection.
      // Preserve the original first-microtask start contract relied on by
      // legacy cache and signed deletion tests; never defer search() twice.
      const acquisition=(async()=>{
        if(startedGeneration!==generation)return {obsolete:true};
        return search(key,{signal:controller.signal});
      })().then(value=>({kind:"result",value}),error=>({kind:"error",error}));
      const outcome=await Promise.race([
        acquisition,
        invalidated.then(({replacement,reason})=>({kind:"replacement",replacement,reason})),
      ]);
      if(outcome.kind==="replacement"||startedGeneration!==generation){
        const replacement=outcome.kind==="replacement"?outcome.replacement:pending.get(key);
        if(!replacement||replacement===task)throw new Error("cache_generation_replacement_missing");
        const fresh=await replacement;
        const next=refreshInfo.get(replacement);
        trace.refreshReplays=1+(next?.refreshReplays||0);
        trace.lastInvalidationReason=next?.lastInvalidationReason||
          (outcome.kind==="replacement"?outcome.reason:"unknown");
        trace.cacheAdmission=next?.cacheAdmission??null;
        trace.cacheAdmissionReason=next?.cacheAdmissionReason??null;
        trace.completeness=next?.completeness??null;
        return fresh;
      }
      if(outcome.kind==="error")throw outcome.error;
      const result=outcome.value;
      let admission;
      try{
        const candidate=classifyAdmission(result);
        admission=candidate && typeof candidate==="object" &&
          typeof candidate.cacheable==="boolean" &&
          ["complete","partial","unknown","empty"].includes(candidate.completeness) &&
          typeof candidate.reason==="string" && /^[a-z_]{3,64}$/.test(candidate.reason) &&
          (!candidate.cacheable || candidate.completeness==="complete")
          ?candidate:{cacheable:false,completeness:"unknown",reason:"classifier_invalid"};
      }catch{
        admission={cacheable:false,completeness:"unknown",reason:"classifier_failed"};
      }
      trace.cacheAdmission=admission.cacheable?"accepted":"rejected";
      trace.cacheAdmissionReason=admission.reason;
      trace.completeness=admission.completeness;
      // Missing/zero entry budgets may not enter an unbounded eviction loop.
      if(admission.cacheable && Number.isSafeInteger(maxEntries) && maxEntries>0){
        while(entries.size>=maxEntries){
          const oldest=entries.keys().next().value;
          if(oldest===undefined)break;
          entries.delete(oldest);
        }
        const entry={at:now(),result:clone(result),completeness:admission.completeness};
        entries.delete(key);
        entries.set(key,entry);
      }
      // Result contract: never wrap, redact, or drop valid partial offers.
      return result;
    }).finally(()=>{
      if(pending.get(key)===task)pending.delete(key);
    });
    refreshInfo.set(task,trace);
    invalidators.set(task,invalidate);
    refreshControllers.set(task,controller);
    pending.set(key,task);
    return task;
  }

  const cachedSearch = async function(key, { allowStale = true, onDiagnostic = null } = {}) {
    const entry = entries.get(key);
    if (entry) {
      const age = Math.max(0, now() - entry.at);
      if (age < ttl) {
        touch(key, entry);
        return { ...clone(entry.result), cache:cacheMeta("fresh", age,
          {completeness:entry.completeness??"complete",refreshing:false}) };
      }
      if (allowStale && age < staleTtl) {
        touch(key, entry);
        void startRefresh(key).catch(() => {});
        return { ...clone(entry.result), cache:cacheMeta("stale", age,
          {completeness:entry.completeness??"complete",refreshing:true}) };
      }
      // Keep the expired snapshot until refresh succeeds; it can rescue a
      // transient provider/deadline failure instead of flashing zero results.
    }
    const previous = entry ? clone(entry.result) : null;
    const refresh=startRefresh(key);
    const result = await refresh;
    // No raw cache key, query, URL or product evidence enters diagnostics.
    // Observers are isolated: failures can never interrupt a valid result.
    if(typeof onDiagnostic==="function"){
      try{
        const info=refreshInfo.get(refresh);
        onDiagnostic({
          refreshReplays:info?.refreshReplays??0,
          lastInvalidationReason:info?.lastInvalidationReason??null,
          cacheAdmission:info?.cacheAdmission??null,
          cacheAdmissionReason:info?.cacheAdmissionReason??null,
          completeness:info?.completeness??null,
        });
      }catch{}
    }
    if (allowStale && (!result.offers?.length) && previous?.offers?.length) {
      touch(key, entry);
      return {
        ...previous,
        cache:cacheMeta("stale-if-error",Math.max(0,now()-entry.at),
          {completeness:entry?.completeness??"complete",refreshing:false}),
      };
    }
    return { ...clone(result), cache:cacheMeta("miss", 0,
      {completeness:refreshInfo.get(refresh)?.completeness??"unknown",refreshing:false}) };
  };

  cachedSearch.peek = (key, { allowStale = true } = {}) => {
    const entry = entries.get(key);
    if (!entry) return null;
    const age = Math.max(0, now() - entry.at);
    if (age >= staleTtl) { entries.delete(key); return null; }
    // Customer SSE must not emit an out-of-date exactMatch, price, or
    // availability snapshot while merchants are being refreshed.
    if (!allowStale && age >= ttl) return null;
    return { ...clone(entry.result), cache:cacheMeta(age < ttl ? "fresh" : "stale", age,
      {completeness:entry.completeness??"complete",refreshing:age>=ttl}) };
  };
  // Read-only, per-key observation for bounded HTTP wait diagnostics.
  // It does not change cache freshness, coalescing, invalidation or offer truth.
  cachedSearch.isPending = (key) => pending.has(key);
  cachedSearch.refresh = (key) => startRefresh(key);
  cachedSearch.clear = (reason="unknown") => {
    const safeReason=reason==="ingest"||reason==="ebay_deletion"?reason:"unknown";
    generation++;
    entries.clear();
    // Build the replacement generation first, then wake all old waiters.
    // Each key has one new request, regardless of subscriber count.
    const obsolete=[...pending.entries()];
    pending.clear();
    for(const [key,prior] of obsolete){
      const replacement=startRefresh(key);
      invalidators.get(prior)?.({replacement,reason:safeReason});
      // Stop obsolete merchant work; each new generation remains independent.
      const controller=refreshControllers.get(prior);
      if(controller&&!controller.signal.aborted)
        controller.abort(new Error("cache_generation_invalidated"));
    }
  };
  cachedSearch.stats = () => ({ entries:entries.size, pending:pending.size, ttlMs:ttl, staleTtlMs:staleTtl });
  return cachedSearch;
}
