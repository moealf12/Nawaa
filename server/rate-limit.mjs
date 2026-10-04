import net from "node:net";

export function requestClientKey(req, { trustProxy = process.env.TRUST_PROXY === "1" || Boolean(process.env.RENDER_SERVICE_ID) } = {}) {
  if (trustProxy) {
    const forwarded = String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (net.isIP(forwarded)) return forwarded;
  }
  const direct = String(req?.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
  return net.isIP(direct) ? direct : "unknown";
}

export function createRateLimiter({ now = Date.now, maxEntries = 5000, staleAfterMs = 15 * 60 * 1000 } = {}) {
  const buckets = new Map();
  let operations = 0;

  function prune(ts) {
    operations += 1;
    if (operations % 128 !== 0 && buckets.size <= maxEntries) return;
    for (const [key, bucket] of buckets) {
      if (ts - bucket.lastSeenAt > staleAfterMs) buckets.delete(key);
    }
    while (buckets.size > maxEntries) buckets.delete(buckets.keys().next().value);
  }

  function consume(key, { capacity = 30, refillPerSecond = 0.5, cost = 1 } = {}) {
    const ts = now();
    prune(ts);
    const safeCapacity = Math.max(1, Number(capacity) || 1);
    const refillPerMs = Math.max(0.000001, Number(refillPerSecond) || 0.000001) / 1000;
    const safeCost = Math.max(0.1, Number(cost) || 1);
    const previous = buckets.get(key) || { tokens: safeCapacity, at: ts, lastSeenAt: ts };
    const tokens = Math.min(safeCapacity, previous.tokens + Math.max(0, ts - previous.at) * refillPerMs);
    const ok = tokens >= safeCost;
    const remaining = ok ? tokens - safeCost : tokens;
    buckets.delete(key);
    buckets.set(key, { tokens: remaining, at: ts, lastSeenAt: ts });
    return {
      ok,
      remaining: Math.max(0, Math.floor(remaining)),
      limit: safeCapacity,
      retryAfterMs: ok ? 0 : Math.ceil((safeCost - tokens) / refillPerMs),
    };
  }

  consume.size = () => buckets.size;
  consume.clear = () => buckets.clear();
  return consume;
}
