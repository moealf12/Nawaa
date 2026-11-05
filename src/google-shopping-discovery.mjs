// Google Shopping is an external discovery destination, not a NAWAA price source.
// Google /search and /shopping/search are excluded from automated crawling;
// Merchant API is for authorized merchant catalog management, not public shopping
// search. Never fetch, cache, or normalize Google Shopping cards as NAWAA offers.
const GOOGLE_SHOPPING_HOST = "www.google.com";
const MAX_QUERY_CODEPOINTS = 200;

export function normalizeGoogleShoppingDiscoveryQuery(rawQuery) {
  if (typeof rawQuery !== "string") return null;
  const value = rawQuery.normalize("NFC").trim().replace(/\s+/gu, " ");
  const count = Array.from(value).length;
  if (count < 2 || count > MAX_QUERY_CODEPOINTS) return null;
  // Product URLs have an independent NAWAA identity-resolution workflow.
  // Never accidentally send a pasted address, token, or credential to Google.
  if (/^(?:https?:\/\/|www\.|[a-z][a-z0-9+.-]*:\/\/)/iu.test(value)) return null;
  // Reject invisible control characters and Unicode format characters.
  if (/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F]/u.test(value)) return null;
  return value;
}

export function buildGoogleShoppingDiscoveryUrl(query) {
  const normalized = normalizeGoogleShoppingDiscoveryQuery(query);
  if (!normalized) return null;
  const url = new URL("https://" + GOOGLE_SHOPPING_HOST + "/search");
  url.searchParams.set("tbm", "shop");
  url.searchParams.set("q", normalized);
  url.searchParams.set("gl", "sa");
  url.searchParams.set("hl", "ar");
  return url.href;
}

// This is the ONLY evidence type the external discovery affordance can emit.
// It MUST NOT be passed to ranking, offer observation storage or search SSE.
export function googleShoppingDiscoveryDescriptor(query) {
  const href = buildGoogleShoppingDiscoveryUrl(query);
  return href ? Object.freeze({
    kind: "external_search_handoff",
    source: "google-shopping",
    label: "استكشف نتائج Google Shopping",
    href,
    method: "user_initiated_link_only",
    returnsOffers: false,
    verifiedPrices: 0,
    saudiDeliveryVerified: null,
    comparableWithNawaa: false,
  }) : null;
}
