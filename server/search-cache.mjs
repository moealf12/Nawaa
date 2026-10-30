// Stale-while-revalidate search snapshots. Fresh hits return immediately; stale
// hits are served immediately while one coalesced refresh runs in background.
export function createSearchCache(search, {
  ttl = 45000,
  staleTtl = 5 * 60 * 1000,
  maxEntries = 80,
  now = Date.now,
} = {}) {
  const entries = new Map();
  const pending = new Map();
  const refreshInfo=new WeakMap();
  let generation = 0;

  const clone = (value) => structuredClone(value);
  const cacheMeta = (mode, ageMs) => ({
    hit: mode !== "miss",
    mode,
    stale: mode === "stale",
    refreshing: mode === "stale",
    ageMs,
    ttlMs: ttl,
    staleTtlMs: staleTtl,
  });

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function startRefresh(key) {
    if (pending.has(key)) return pending.get(key);
    const trace={refreshReplays:0};
    const task = Promise.resolve().then(async () => {
      let startedGeneration = generation;
      let result = await search(key);
      if (generation !== startedGeneration) {
        // A catalog invalidation requires another search before publishing
        // current evidence. Count the replay, do not bypass it.
        trace.refreshReplays++;
        startedGeneration = generation;
        result = await search(key);
      }
      if (generation === startedGeneration && result.offers?.length) {
        while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        const entry = { at: now(), result:clone(result) };
        entries.delete(key);
        entries.set(key, entry);
      }
      return result;
    }).finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
    refreshInfo.set(task,trace);
    pending.set(key, task);
    return task;
  }

  const cachedSearch = async function(key, { allowStale = true, onDiagnostic = null } = {}) {
    const entry = entries.get(key);
    if (entry) {
      const age = Math.max(0, now() - entry.at);
      if (age < ttl) {
        touch(key, entry);
        return { ...clone(entry.result), cache:cacheMeta("fresh", age) };
      }
      if (allowStale && age < staleTtl) {
        touch(key, entry);
        void startRefresh(key).catch(() => {});
        return { ...clone(entry.result), cache:cacheMeta("stale", age) };
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
      try{onDiagnostic({refreshReplays:refreshInfo.get(refresh)?.refreshReplays??0});}catch{}
    }
    if (allowStale && (!result.offers?.length) && previous?.offers?.length) {
      touch(key, entry);
      return {
        ...previous,
        cache:{...cacheMeta("stale-if-error", Math.max(0, now() - entry.at)), hit:true, stale:true, refreshing:false},
      };
    }
    return { ...clone(result), cache:cacheMeta("miss", 0) };
  };

  cachedSearch.peek = (key, { allowStale = true } = {}) => {
    const entry = entries.get(key);
    if (!entry) return null;
    const age = Math.max(0, now() - entry.at);
    if (age >= staleTtl) { entries.delete(key); return null; }
    // Customer SSE must not emit an out-of-date exactMatch, price, or
    // availability snapshot while merchants are being refreshed.
    if (!allowStale && age >= ttl) return null;
    return { ...clone(entry.result), cache:cacheMeta(age < ttl ? "fresh" : "stale", age) };
  };
  // Read-only, per-key observation for bounded HTTP wait diagnostics.
  // It does not change cache freshness, coalescing, invalidation or offer truth.
  cachedSearch.isPending = (key) => pending.has(key);
  cachedSearch.refresh = (key) => startRefresh(key);
  cachedSearch.clear = () => { generation++; entries.clear(); pending.clear(); };
  cachedSearch.stats = () => ({ entries:entries.size, pending:pending.size, ttlMs:ttl, staleTtlMs:staleTtl });
  return cachedSearch;
}
