import { setTimeout as sleep } from "node:timers/promises";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_GET = new Set([403, 405, 501]);

export function parseExtraPrice(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^(?:[0-9]+)(?:\.[0-9]{1,2})?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeExtraUrl(raw, base) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw, base || "https://www.extra.com");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const host = url.hostname.toLowerCase();
    if (host !== "extra.com" && host !== "www.extra.com") return null;
    if (url.pathname.includes("%2f") || url.pathname.includes("%2F") || /[\r\n]/.test(raw)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

export function extraUrlSkuHint(url, sku) {
  if (!sku || !/^[A-Za-z0-9_-]{4,64}$/.test(String(sku))) return false;
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean).map(s => decodeURIComponent(s));
    const index = segments.findIndex(s => s.toLowerCase() === String(sku).toLowerCase());
    return index > 0 && segments[index - 1].toLowerCase() === "p";
  } catch { return false; }
}

export async function checkExtraProductUrl(rawUrl, expectedSku, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const maxRedirects = Math.min(5, Math.max(0, options.maxRedirects ?? 3));
  const timeoutMs = Math.min(10000, Math.max(100, options.timeoutMs ?? 5000));
  const deadline = Date.now() + Math.max(100, options.totalTimeoutMs ?? 12000);
  let current = normalizeExtraUrl(rawUrl);
  if (!current) return { status: "INVALID_URL", url: null, identityVerified: false };
  const visited = new Set();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (visited.has(current)) return { status: "REDIRECT_LOOP", url: null, identityVerified: false };
    visited.add(current);
    if (!extraUrlSkuHint(current, expectedSku)) return { status: "SKU_HINT_MISMATCH", url: null, identityVerified: false };
    let redirect = false;
    for (const method of ["HEAD", "GET"]) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { status: "TIMEOUT", url: null, identityVerified: false };
      let res;
      try {
        res = await fetchImpl(current, {
          method, redirect: "manual",
          signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
          headers: { Accept: method === "HEAD" ? "*/*" : "text/html", "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8" }
        });
      } catch { return { status: "RETRYABLE_ERROR", url: null, identityVerified: false }; }
      if (REDIRECTS.has(res.status)) {
        const location = res.headers.get("location");
        let target;
        try { target = normalizeExtraUrl(new URL(location, current).href); } catch { target = null; }
        if (!target) return { status: "UNSAFE_REDIRECT", url: null, identityVerified: false };
        if (hop === maxRedirects) return { status: "REDIRECT_LIMIT", url: null, identityVerified: false };
        current = target; redirect = true; break;
      }
      if (res.status === 200) {
        // Link health only: neither page identity nor price is independently attested.
        return { status: "OK", url: current, identityVerified: false };
      }
      if (method === "HEAD" && RETRYABLE_GET.has(res.status)) continue;
      if (res.status === 404 || res.status === 410) return { status: "NOT_FOUND", url: null, identityVerified: false };
      return { status: RETRYABLE.has(res.status) ? "RETRYABLE_ERROR" : "REJECTED", url: null, identityVerified: false };
    }
    if (!redirect) return { status: "REJECTED", url: null, identityVerified: false };
  }
  return { status: "REDIRECT_LIMIT", url: null, identityVerified: false };
}

export async function resolveExtraProductUrl(productData, fallback = null, options = {}) {
  if (!productData || typeof productData !== "object") return null;
  const price = parseExtraPrice(productData.salePrice) ?? parseExtraPrice(productData.price);
  if (price === null) return null;
  const sku = productData.sku || productData.uniqueId || productData.id;
  if (typeof sku !== "string" && typeof sku !== "number") return null;
  const maxRetries = Math.min(3, Math.max(1, Math.trunc(options.maxRetries ?? 2)));
  const delayMs = Math.min(2000, Math.max(0, options.delayMs ?? 300));
  const candidates = [...new Set([productData.product_url, productData.url, fallback].filter(x => typeof x === "string" && x.trim()))];
  const deadline = Date.now() + Math.max(100, options.totalTimeoutMs ?? 12000);
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const result = await checkExtraProductUrl(candidate, String(sku), { ...options, totalTimeoutMs: remaining });
      if (result.status === "OK") return result.url;
      if (result.status !== "RETRYABLE_ERROR" && result.status !== "TIMEOUT") break;
      if (attempt + 1 < maxRetries) await sleep(Math.min(delayMs, Math.max(0, deadline - Date.now())));
    }
  }
  return null;
}
