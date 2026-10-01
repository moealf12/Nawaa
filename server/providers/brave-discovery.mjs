import { resolveProductUrl } from "../url-resolver.mjs";
import { normalizeSearchQuery } from "../../src/search-query.mjs";

const SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

const COMMERCE_HOST_HINTS = [
  "amazon.", "shein.com", "aliexpress.", "temu.com", "ebay.", "noon.com",
  "jarir.com", "extra.com", "sharafdg.com", "carrefour", "iherb.com", "nike.com",
  "adidas.", "namshi.com", "ounass.", "sephora.", "ikea.", "walmart.", "bestbuy.",
  "target.com", "newegg.", "bhphotovideo.com", "etsy.com", "asos.com", "farfetch.com",
  "net-a-porter.com", "zara.com", "hm.com", "uniqlo.com", "decathlon."
];

const PRODUCT_PATH_RE = /\/(?:dp|gp\/product|product|products|p|item|itm|goods|detail|pd|sku)\//i;
const NAV_PATH_RE = /\/(?:search|category|categories|collections?|blog|help|support|account|login|cart|wishlist)(?:\/|$|\?)/i;

export function braveDiscoveryConfigured() {
  return Boolean(String(process.env.BRAVE_SEARCH_API_KEY || "").trim());
}

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function commerceHost(host) {
  return COMMERCE_HOST_HINTS.some((hint) => host.includes(hint));
}

export function rankDiscoveryCandidates(results = [], query = "", limit = 10) {
  const tokens = normalizeSearchQuery(query).split(" ").filter((token) => token.length >= 2);
  return results
    .map((result) => {
      const url = String(result?.url || "");
      const host = hostOf(url);
      if (!host || !url.startsWith("https://") || NAV_PATH_RE.test(new URL(url).pathname)) return null;
      const title = normalizeSearchQuery(result?.title || "");
      const description = normalizeSearchQuery(result?.description || "");
      const tokenHits = tokens.filter((token) => title.includes(token) || description.includes(token)).length;
      const productPath = PRODUCT_PATH_RE.test(new URL(url).pathname);
      const commerce = commerceHost(host);
      if (!commerce && !productPath) return null;
      const score = (commerce ? 3 : 0) + (productPath ? 2 : 0) + (tokens.length ? tokenHits / tokens.length : 0);
      return { ...result, url, host, score };
    })
    .filter(Boolean)
    .sort((a,b) => b.score - a.score)
    .filter((item, index, all) => all.findIndex((other) => other.url === item.url) === index)
    .slice(0, Math.max(1, Math.min(20, limit)));
}

async function resolveCandidate(candidate) {
  const offer = await resolveProductUrl(candidate.url);
  if (!Number.isFinite(offer?.productPrice) || !offer?.extraction?.structuredPriceFound) return null;
  return {
    ...offer,
    provider:"brave-discovery",
    providerMarket:candidate.host,
    exactMatch:false,
    matchConfidence:0,
    sourceMeta:{
      ...(offer.sourceMeta || {}),
      discoveryEngine:"Brave Search",
      discoveryTitle:candidate.title || null,
      discoveryDescription:candidate.description || null,
    },
  };
}

export async function searchBraveDiscovery(query, options = {}) {
  const apiKey = String(process.env.BRAVE_SEARCH_API_KEY || "").trim();
  if (!apiKey) return { provider:"brave-discovery", ok:false, searchedMarkets:[], offers:[], errors:[] };

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", `${query} price buy online`);
  url.searchParams.set("country", "SA");
  url.searchParams.set("search_lang", "en");
  url.searchParams.set("ui_lang", "ar-SA");
  url.searchParams.set("safesearch", "moderate");
  url.searchParams.set("count", String(Math.max(5, Math.min(20, Number(options.resultCount || 20)))));

  const response = await fetch(url, {
    headers:{ accept:"application/json", "x-subscription-token":apiKey },
    signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`brave-discovery: HTTP ${response.status}`);
  const payload = await response.json();
  const candidates = rankDiscoveryCandidates(payload?.web?.results || [], query, Number(options.resolveCount || 10));
  const settled = await Promise.allSettled(candidates.map(resolveCandidate));
  const offers = settled.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
  const failures = settled.filter((r) => r.status === "rejected").length;

  return {
    provider:"brave-discovery",
    ok:offers.length > 0,
    searchedMarkets:[{ id:"brave-web", countryCode:"GLOBAL", countryNameAr:"الويب" }],
    offers,
    errors:failures ? [{ market:"brave-web", error:`${failures} discovered product pages could not be verified` }] : [],
    diagnostics:{ webResults:Array.isArray(payload?.web?.results) ? payload.web.results.length : 0, candidates:candidates.length, verifiedOffers:offers.length },
  };
}
