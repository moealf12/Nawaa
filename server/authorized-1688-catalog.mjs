// Transport for an operator-approved 1688 catalog feed.
// Never calls 1688 storefront pages, proxies, or undocumented endpoints.
import { isIP } from "node:net";

function safeFeedUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.hash ||
        (url.port && url.port !== "443") ||
        !host.includes(".") || isIP(host) ||
        /(^|\.)(localhost|local|internal|invalid|test)$/.test(host)) return null;
    return url;
  } catch { return null; }
}

export function is1688Configured(env = process.env) {
  const url = safeFeedUrl(env.NAWAA_1688_CATALOG_URL);
  const allowed = String(env.NAWAA_1688_ALLOWED_HOSTS || "")
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return env.NAWAA_1688_ENABLED === "1" &&
    url !== null && allowed.includes(url.hostname.toLowerCase()) &&
    typeof env.NAWAA_1688_CATALOG_TOKEN === "string" &&
    env.NAWAA_1688_CATALOG_TOKEN.trim().length > 0;
}

export async function fetchAuthorized1688Catalog(query, {
  signal, limit = 20, env = process.env, fetchImpl = globalThis.fetch,
} = {}) {
  if (!is1688Configured(env)) throw new Error("1688_SOURCE_NOT_CONFIGURED");
  if (typeof query !== "string" || !query.trim() || query.length > 160)
    throw new Error("1688_INVALID_QUERY");
  const url = safeFeedUrl(env.NAWAA_1688_CATALOG_URL);
  const timeout = AbortSignal.timeout(4500);
  const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(url.href, {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json",
      authorization: "Bearer " + env.NAWAA_1688_CATALOG_TOKEN,
      "user-agent": "NAWAA-1688-Authorized-Catalog/1.0",
    },
    body: JSON.stringify({query: query.trim(), limit: Math.min(40, Math.max(1, limit))}),
    redirect: "error",
    signal: activeSignal,
  });
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("1688_FEED_HTTP_" + response.status);
  }
  if (!/^application\/json(?:;|$)/i.test(response.headers?.get?.("content-type") || "")) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("1688_FEED_NOT_JSON");
  }
  const max = 1_048_576;
  const length = Number(response.headers?.get?.("content-length") || 0);
  if (length > max) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("1688_FEED_TOO_LARGE");
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const raw = await response.text();
    if (Buffer.byteLength(raw) > max) throw new Error("1688_FEED_TOO_LARGE");
    return JSON.parse(raw);
  }
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > max) throw new Error("1688_FEED_TOO_LARGE");
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
