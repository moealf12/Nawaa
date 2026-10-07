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
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  let raw=String(value).trim();
  if (!raw || /^(?:n\/?a|na|null|undefined|unknown|--|-|not available)$/i.test(raw)) return null;
  raw=raw.replace(/[\s\u00a0]/g,"").replace(/[^0-9.,+-]/g,"");
  if (!/[0-9]/.test(raw)) return null;
  const comma=raw.lastIndexOf(","), dot=raw.lastIndexOf(".");
  let normalized=raw;
  if (comma>=0 && dot>=0) {
    const decimal=comma>dot?",":".";
    const thousands=decimal===","?".":",";
    normalized=raw.split(thousands).join("").replace(decimal,".");
  } else if (comma>=0) {
    const tail=raw.length-comma-1;
    normalized=tail===3 && /^[-+]?\d{1,3}(?:,\d{3})+$/.test(raw) ? raw.replaceAll(",","") : raw.replace(",",".");
  } else if (dot>=0) {
    const tail=raw.length-dot-1;
    normalized=tail===3 && /^[-+]?\d{1,3}(?:\.\d{3})+$/.test(raw) ? raw.replaceAll(".","") : raw;
  }
  const num=Number(normalized);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

export function normalizeCondition(value = "") {
  const v = String(value).toLowerCase().replace(/[_-]+/g," ").trim();
  if (!v) return "unknown";
  if (/\b(refurbished?|renewed|remanufactured)\b/.test(v)) return "refurbished";
  if (/\b(open\s*box)\b/.test(v)) return "open_box";
  if (/\b(like\s*new|used|pre\s*owned|second\s*hand)\b/.test(v)) return "used";
  if (/\bnew\b/.test(v)) return "new";
  return "unknown";
}

export function normalizeAvailability(value = "") {
  const v=String(value).toLowerCase().replace(/[_-]+/g," ").trim();
  if (!v) return "unknown";
  if (/\b(unavailable|not\s+available|out\s+of\s+stock|outofstock|sold\s+out)\b/.test(v)) return "out_of_stock";
  if (/\b(pre\s*order|preorder)\b/.test(v)) return "preorder";
  if (/\b(in\s*stock|instock|available)\b/.test(v)) return "in_stock";
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
