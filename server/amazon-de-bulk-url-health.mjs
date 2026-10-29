// Read-only Amazon Germany link-health diagnostics.
// A matching ASIN and an HTTP 200 do NOT attest product identity, a buybox
// seller, price, variant, stock, or delivery to Saudi Arabia.
// Deliberately independent from customer search/publication paths.
const AMAZON_DE_HOSTS = new Set(["amazon.de", "www.amazon.de"]);
const AMAZON_ASIN = /^[A-Z0-9]{10}$/;
const MAX_BATCH = 100;
const MAX_CONCURRENCY = 6;
const MAX_REDIRECTS = 2;
const ACCEPT = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
};

export function normalizeAmazonDeProductUrl(rawUrl, expectedAsin) {
  if (typeof rawUrl !== "string" || typeof expectedAsin !== "string") return null;
  const asin = expectedAsin.trim().toUpperCase();
  if (!AMAZON_ASIN.test(asin) || /[\r\n\\]/.test(rawUrl)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") ||
        !AMAZON_DE_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (/%(?:2f|5c|00)/i.test(url.pathname)) return null;
    const match = /^\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/i.exec(url.pathname);
    if (!match || match[1].toUpperCase() !== asin) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function report(status, url = null) {
  return {
    status, url, linkReachable: status === "LINK_REACHABLE_NOT_ATTESTED",
    identityVerified: false, priceVerified: false,
    buyboxVerified: false, saudiDeliveryVerified: false, customerPublishable: false,
  };
}

export async function fastCheckAmazonUrl(rawUrl, expectedAsin, {
  fetchImpl = globalThis.fetch, timeoutMs = 4000, signal,
} = {}) {
  let current = normalizeAmazonDeProductUrl(rawUrl, expectedAsin);
  if (!current) return report("INVALID_PRODUCT_URL");
  if (typeof fetchImpl !== "function") return report("TRANSPORT_UNAVAILABLE");
  if (signal?.aborted) return report("ABORTED");

  const budget = Math.max(100, Math.min(8000, Number(timeoutMs) || 4000));
  // One deadline covers the complete redirect chain, not one deadline per hop.
  const timeout = AbortSignal.timeout(budget);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const visited = new Set();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (visited.has(current)) return report("REDIRECT_LOOP");
    visited.add(current);
    let response;
    try {
      response = await fetchImpl(current, {
        method: "GET", headers: ACCEPT, redirect: "manual", signal: combined,
      });
    } catch {
      if (signal?.aborted) return report("ABORTED");
      return report(timeout.aborted ? "TIMEOUT" : "NETWORK_ERROR");
    }

    // Never retain or parse an arbitrary HTML body as price evidence.
    try { await response.body?.cancel?.(); } catch {}
    if (response.status === 200) return report("LINK_REACHABLE_NOT_ATTESTED", current);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop === MAX_REDIRECTS) return report("REDIRECT_LIMIT");
      const location = response.headers?.get?.("location");
      if (!location) return report("REDIRECT_NO_LOCATION");
      let target;
      try { target = new URL(location, current).href; } catch { return report("REDIRECT_INVALID"); }
      const normalized = normalizeAmazonDeProductUrl(target, expectedAsin);
      if (!normalized) return report("UNSAFE_OR_MISMATCHED_REDIRECT");
      current = normalized;
      continue;
    }
    if (response.status === 404 || response.status === 410) return report("NOT_FOUND");
    if (response.status === 403 || response.status === 429) return report("ACCESS_RESTRICTED");
    return report("HTTP_UNVERIFIED");
  }
  return report("REDIRECT_LIMIT");
}

/**
 * Inspect already-discovered product links; does not discover Amazon products.
 * The results ARRAY is indexed like the input, preserving duplicate ASIN rows.
 * Success counts reachable links, never approved shopper offers.
 */
export async function processProductsBulk(products, concurrencyLimit = 4, options = {}) {
  if (!Array.isArray(products)) throw new TypeError("products must be an array");
  if (products.length > MAX_BATCH) throw new RangeError("Amazon DE diagnostic batch exceeds 100");
  const requested = Number(concurrencyLimit);
  const concurrency = Number.isFinite(requested)
    ? Math.min(MAX_CONCURRENCY, Math.max(1, Math.trunc(requested))) : 4;
  const results = new Array(products.length);
  let cursor = 0;
  let success = 0;
  let failed = 0;

  async function worker() {
    while (cursor < products.length) {
      const index = cursor++;
      const product = products[index];
      const candidateAsin = product?.asin ?? product?.sku ?? product?.uniqueId;
      const asin = typeof candidateAsin === "string" ? candidateAsin.trim().toUpperCase() : "";
      const candidateUrl = product?.product_url ?? product?.url;
      let outcome;
      try {
        outcome = await fastCheckAmazonUrl(candidateUrl, asin, options);
      } catch {
        outcome = report("NETWORK_ERROR");
      }
      if (outcome.linkReachable) success++;
      else failed++;
      results[index] = { index, asin: AMAZON_ASIN.test(asin) ? asin : null, ...outcome };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, worker));
  return {
    mode: "READ_ONLY_URL_HEALTH_DIAGNOSTIC",
    sourceId: "amazon-de", success, failed, results,
    customerPublishable: false,
  };
}
