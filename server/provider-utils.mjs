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

// The Schema.org OfferItemCondition value is an exact enumeration, not a
// word to discover inside arbitrary external URLs. Google Merchant Center
// accepts the canonical schema.org URLs or bare member names.
const SCHEMA_ITEM_CONDITIONS=Object.freeze({
  newcondition:"new",
  usedcondition:"used",
  refurbishedcondition:"refurbished",
  // Damaged goods must never be silently presented as new or equivalent used.
  damagedcondition:"unknown",
});

export function normalizeCondition(value = "") {
  // An @id-only linked enumeration is supported; a larger object may contain
  // conflicting evidence and must not be string-coerced to "[object Object]".
  if(value && typeof value==="object"){
    if(Array.isArray(value)||Object.keys(value).length!==1||
       !Object.hasOwn(value,"@id"))return "unknown";
    value=value["@id"];
  }
  if(typeof value!=="string"||value.length>256)return "unknown";
  const raw=value.trim();
  if(!raw)return "unknown";
  const bare=raw.match(/^([A-Za-z]+Condition)$/);
  if(bare)return SCHEMA_ITEM_CONDITIONS[bare[1].toLowerCase()]||"unknown";
  // A URL from a random hostname or with query/hash is not product-condition
  // evidence, even when a path or query parameter contains the word "new".
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)){
    let parsed;
    try{parsed=new URL(raw);}catch{return "unknown";}
    if(!["http:","https:"].includes(parsed.protocol)||
       parsed.hostname!=="schema.org"||parsed.port||
       parsed.username||parsed.password||parsed.search||parsed.hash)
      return "unknown";
    const token=parsed.pathname.match(/^\/([A-Za-z]+Condition)\/?$/);
    return token?SCHEMA_ITEM_CONDITIONS[token[1].toLowerCase()]||"unknown":"unknown";
  }
  const v=raw.toLowerCase().replace(/[_-]+/g," ");
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
