export function jsonResponse(res, status, body, origin = "*") {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  });
  res.end(JSON.stringify(body));
}

export function allowedOrigin(requestOrigin = "") {
  const configured = (process.env.NAWAA_ALLOWED_ORIGINS || "https://moealf12.github.io,http://localhost:8000,http://127.0.0.1:8000")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (!requestOrigin) return configured[0] || "*";
  return configured.includes(requestOrigin) ? requestOrigin : "";
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
