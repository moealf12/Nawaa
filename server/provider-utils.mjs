export function jsonResponse(res, status, body, origin = "*", extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "accept,content-type,authorization",
    "vary": "origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

export function allowedOrigin(requestOrigin = "") {
  // NAWAA's current search API is public and read-only. No credentials, cookies,
  // account data, or write actions are accepted here, so GET/OPTIONS can safely
  // be consumed by the GitHub Pages frontend and embedded mobile browsers.
  if (!requestOrigin) return "*";
  return "*";
}

export function parseMoney(value) {
  if (value === null || value === undefined) return null;
  const num = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : null;
}

export function normalizeCondition(value = "") {
  const v = String(value).toLowerCase();
  if (v.includes("new")) return "new";
  if (v.includes("refurb")) return "refurbished";
  if (v.includes("open box") || v.includes("open_box")) return "open_box";
  if (v.includes("used") || v.includes("pre-owned") || v.includes("preowned")) return "used";
  return "unknown";
}

export function makeProviderError(provider, error) {
  return {
    provider,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    offers: [],
  };
}
