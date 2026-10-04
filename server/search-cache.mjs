// Short-lived market snapshots: failures never occupy the cache.
export function createSearchCache(search, { ttl = 60000, maxEntries = 80, now = Date.now } = {}) {
  const entries = new Map();
  const pending = new Map();
  let generation = 0;
  const cachedSearch = async function(key) {
    const entry = entries.get(key);
    if (entry && now() - entry.at < ttl) {
      return { ...structuredClone(entry.result), cache: { hit: true, ageMs: now() - entry.at, ttlMs: ttl } };
    }
    entries.delete(key);
    if (!pending.has(key)) {
      const task = Promise.resolve().then(async () => {
        let startedGeneration = generation;
        let result = await search(key);
        // If a crawler/import invalidated the catalog while this request was in
        // flight, transparently refresh once instead of returning an empty result.
        if (generation !== startedGeneration) {
          startedGeneration = generation;
          result = await search(key);
        }
        if (generation === startedGeneration && result.offers?.length && !result.errors?.length) {
          while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
          entries.set(key, { at: now(), result: structuredClone(result) });
        }
        return result;
      }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
      pending.set(key, task);
    }
    return { ...structuredClone(await pending.get(key)), cache: { hit: false, ageMs: 0, ttlMs: ttl } };
  };
  cachedSearch.clear = () => { generation++; entries.clear(); pending.clear(); };
  return cachedSearch;
}
