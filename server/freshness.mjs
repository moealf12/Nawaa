const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const HARD_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function parseTime(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

export function candidateObservedAt(entry, fallbackObservedAt = null) {
  const product = entry?.product || {};
  const offer = Array.isArray(product?.offers)
    ? product.offers[0]
    : product?.offers?.offers?.[0] || product?.offers || null;

  const candidates = [
    entry?.observedAt,
    product?.observedAt,
    product?.dateModified,
    product?.updatedAt,
    product?.updated_at,
    offer?.observedAt,
    offer?.updatedAt,
    offer?.updated_at,
    fallbackObservedAt,
  ];

  for (const value of candidates) {
    const parsed = parseTime(value);
    if (parsed !== null) return new Date(parsed).toISOString();
  }
  return null;
}

export function freshnessFor(entry, now = Date.now(), fallbackObservedAt = null) {
  const observedAt = candidateObservedAt(entry, fallbackObservedAt);
  if (!observedAt) {
    return {
      observedAt:null,
      ageMs:null,
      freshness:0.5,
      status:"unknown",
      stale:false,
    };
  }

  const ageMs = Math.max(0, now - Date.parse(observedAt));
  let freshness = 1;
  let status = "fresh";

  if (ageMs > HARD_STALE_AFTER_MS) {
    freshness = 0.2;
    status = "stale";
  } else if (ageMs > DEFAULT_STALE_AFTER_MS) {
    const span = HARD_STALE_AFTER_MS - DEFAULT_STALE_AFTER_MS;
    const progress = Math.min(1, (ageMs - DEFAULT_STALE_AFTER_MS) / span);
    freshness = Number((0.85 - progress * 0.55).toFixed(3));
    status = "aging";
  }

  return {
    observedAt,
    ageMs,
    freshness,
    status,
    stale: ageMs > HARD_STALE_AFTER_MS,
  };
}

export function annotateCandidateFreshness(candidates = [], observedAt = null, now = Date.now()) {
  return candidates.map((entry) => ({
    ...entry,
    freshness: freshnessFor(entry, now, observedAt),
  }));
}

export function freshnessSummary(candidates = []) {
  const items = candidates.map((entry) => ({
    strategy:entry.strategy,
    adapterId:entry.adapterId || null,
    ...(entry.freshness || freshnessFor(entry)),
  }));

  return {
    freshestObservedAt: items
      .map((item) => item.observedAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] || null,
    staleSources: items
      .filter((item) => item.stale)
      .map((item) => item.adapterId ? `${item.strategy}:${item.adapterId}` : item.strategy),
    unknownFreshnessSources: items
      .filter((item) => item.status === "unknown")
      .map((item) => item.adapterId ? `${item.strategy}:${item.adapterId}` : item.strategy),
    sources:items,
  };
}
