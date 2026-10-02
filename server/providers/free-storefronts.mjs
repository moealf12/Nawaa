import { resolveProductUrl } from "../url-resolver.mjs";
import { normalizeSearchQuery, parseSearchIntent } from "../../src/search-query.mjs";
import { sourceReliability } from "../source-reliability.mjs";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const STORES = [
  {
    id:"shein-sa", name:"SHEIN", countryCode:"SA", countryNameAr:"السعودية", brands:["shein"], categories:["clothing","shoes","bag","beauty","jewelry","home","toy"],
    search:(q)=>"https://ar.shein.com/pdsearch/"+encodeURIComponent(q).replace(/%20/g,"-")+"/",
    productPath:/-p-\d+\.html(?:[?#]|$)/i,
  },
  {
    id:"aliexpress-cn", name:"AliExpress", countryCode:"CN", countryNameAr:"الصين", categories:["*"],
    search:(q)=>"https://www.aliexpress.com/w/wholesale-"+encodeURIComponent(q).replace(/%20/g,"-")+".html",
    productPath:/\/item\/\d+\.html(?:[?#]|$)/i,
  },
  {
    id:"temu-global", name:"Temu", countryCode:"CN", countryNameAr:"الصين", categories:["*"],
    search:(q)=>"https://www.temu.com/search_result.html?search_key="+encodeURIComponent(q),
    productPath:/\/(?:goods|item)\.html(?:[?#]|$)|-g-\d+\.html/i,
  },
  {
    id:"iherb-sa", name:"iHerb", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["beauty","grocery","pet","baby","other"],
    search:(q)=>"https://sa.iherb.com/search?kw="+encodeURIComponent(q),
    productPath:/\/pr\/[^?#]+\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"ikea-sa", name:"IKEA Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["ikea"], categories:["furniture","home","kitchen","office"],
    search:(q)=>"https://www.ikea.com/sa/en/search/?q="+encodeURIComponent(q),
    productPath:/\/p\/[^?#]+-\d+(?:[/?#]|$)/i,
  },
  {
    id:"asos-global", name:"ASOS", countryCode:"GB", countryNameAr:"بريطانيا", brands:["asos"], categories:["clothing","shoes","bag","beauty"],
    search:(q)=>"https://www.asos.com/search/?q="+encodeURIComponent(q),
    productPath:/\/prd\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"farfetch-sa", name:"Farfetch", countryCode:"GB", countryNameAr:"بريطانيا", brands:["farfetch"], categories:["clothing","shoes","bag","jewelry","watch"],
    search:(q)=>"https://www.farfetch.com/sa/shopping/items.aspx?q="+encodeURIComponent(q),
    productPath:/\/shopping\/[^?#]+\/item-\d+\.aspx(?:[?#]|$)/i,
  },
  {
    id:"etsy-global", name:"Etsy", countryCode:"US", countryNameAr:"الولايات المتحدة", brands:["etsy"], categories:["jewelry","clothing","bag","home","furniture","toy","office","other"],
    search:(q)=>"https://www.etsy.com/search?q="+encodeURIComponent(q),
    productPath:/\/listing\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"newegg-global", name:"Newegg", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["phone","laptop","desktop","monitor","audio","camera","accessory","network","appliance"],
    search:(q)=>"https://www.newegg.com/global/sa-en/p/pl?d="+encodeURIComponent(q),
    productPath:/\/p\/[A-Z0-9-]+(?:[/?#]|$)/i,
  },
  {
    id:"bhphoto-us", name:"B&H Photo", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["camera","audio","laptop","phone","tablet","accessory","other"],
    search:(q)=>"https://www.bhphotovideo.com/c/search?q="+encodeURIComponent(q)+"&sts=ma",
    productPath:/\/c\/product\/\d+(?:-[A-Z0-9_-]+)?(?:[/?#]|$)/i,
  },
  {
    id:"walmart-us", name:"Walmart", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["*"],
    search:(q)=>"https://www.walmart.com/search?q="+encodeURIComponent(q),
    productPath:/\/ip\/[^?#]+\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"bestbuy-us", name:"Best Buy", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["phone","laptop","desktop","monitor","audio","camera","appliance","tv","console","game","accessory"],
    search:(q)=>"https://www.bestbuy.com/site/searchpage.jsp?st="+encodeURIComponent(q),
    productPath:/\/site\/[^?#]+\/\d+\.p(?:[?#]|$)/i,
  },
  {
    id:"adidas-sa", name:"adidas Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["adidas"], categories:["clothing","shoes","sports","bag"],
    search:(q)=>"https://www.adidas.sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/[A-Z0-9_-]+\.html(?:[?#]|$)/i,
  },
  {
    id:"nike-sa", name:"Nike Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["nike"], categories:["clothing","shoes","sports","bag"],
    search:(q)=>"https://www.nike.sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/[^?#]+(?:[?#].*)?$/i,
  },
  {
    id:"sephora-sa", name:"Sephora Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["sephora"], categories:["beauty","perfume"],
    search:(q)=>"https://www.sephora.me/sa-en/search?q="+encodeURIComponent(q),
    productPath:/\/p\/[^?#]+(?:[?#]|$)/i,
  },
  {
    id:"namshi-sa", name:"Namshi", countryCode:"SA", countryNameAr:"السعودية", brands:["namshi"], categories:["clothing","shoes","bag","beauty","jewelry","sports","baby"],
    search:(q)=>"https://www.namshi.com/saudi-en/search?q="+encodeURIComponent(q),
    productPath:/\/saudi-en\/buy-[^?#]+\/[^/?#]+\/p\/?(?:[?#]|$)/i,
  },
  {
    id:"centrepoint-sa", name:"Centrepoint", countryCode:"SA", countryNameAr:"السعودية", brands:["centrepoint"], categories:["clothing","shoes","bag","beauty","home","furniture","toy","baby","sports"],
    search:(q)=>"https://www.centrepointstores.com/sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/sa\/en\/(?:buy-[^?#]+\/p\/[^/?#]+|p\/[^/?#]+)(?:[/?#]|$)/i,
  },
  {
    id:"maxfashion-sa", name:"Max Fashion", countryCode:"SA", countryNameAr:"السعودية", brands:["maxfashion"], categories:["clothing","shoes","bag","baby","home"],
    search:(q)=>"https://www.maxfashion.com/sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/sa\/en\/buy-[^?#]+\/p\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"decathlon-sa", name:"Decathlon Saudi", countryCode:"SA", countryNameAr:"السعودية", brands:["decathlon"], categories:["sports","shoes","clothing","bag","toy","baby"],
    search:(q)=>"https://decathlon.com.sa/search?q="+encodeURIComponent(q),
    productPath:/\/products\/[^/?#]+(?:[/?#]|$)/i,
  },
  {
    id:"niceone-sa", name:"Nice One", countryCode:"SA", countryNameAr:"السعودية", brands:["niceone"], categories:["beauty","perfume","grocery","sports","baby","other"],
    search:(q)=>"https://niceonesa.com/en/search?q="+encodeURIComponent(q),
    productPath:/\/en\/[^?#]+-n\d+(?:[/?#]|$)/i,
  },
];

function decodeHtml(value = "") {
  return String(value)
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value = "") {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function canonicalizeCandidateUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch { return url; }
}

function sameHost(candidate, base) {
  try {
    const a = new URL(candidate);
    const b = new URL(base);
    const ah = a.hostname.toLowerCase().replace(/^www\./, "");
    const bh = b.hostname.toLowerCase().replace(/^www\./, "");
    return ah === bh || ah.endsWith("." + bh) || bh.endsWith("." + ah);
  } catch { return false; }
}

export function extractProductLinks(html, searchUrl, store, query, limit = Infinity) {
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const out = [];
  const seen = new Set();
  const addCandidate = (rawUrl, rawLabel = "") => {
    let url;
    try { url = new URL(decodeHtml(rawUrl).replace(/\\u002F/gi, "/").replace(/\\\//g, "/"), searchUrl).href; } catch { return; }
    if (!sameHost(url, searchUrl) || !store.productPath.test(url)) return;
    const label = stripHtml(rawLabel);
    const haystack = normalizeSearchQuery(label + " " + url);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    const score = tokens.length ? hits / tokens.length : 0.5;
    if (score < 0.2 && tokens.length > 1) return;
    url = canonicalizeCandidateUrl(url);
    if (seen.has(url)) return;
    seen.add(url);
    out.push({ url, label, score });
  };

  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html))) addCandidate(match[1], match[2]);

  // Modern storefronts often hydrate search results in JSON instead of rendering
  // product anchors server-side. Scan quoted URL values as a second discovery path.
  const quotedUrlRe = /["']((?:https?:)?\\?\/\\?\/[^"'<>\\s]+|\\?\/[^"'<>\\s]+)["']/gi;
  while ((match = quotedUrlRe.exec(html))) addCandidate(match[1], "");
  const ranked = out.sort((a,b) => b.score - a.score);
  return Number.isFinite(limit) ? ranked.slice(0, Math.max(0, limit)) : ranked;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers:{
      accept:"text/html,application/xhtml+xml",
      "accept-language":"en-US,en;q=0.9,ar-SA;q=0.8",
      "cache-control":"no-cache",
      pragma:"no-cache",
      "sec-fetch-dest":"document",
      "sec-fetch-mode":"navigate",
      "sec-fetch-site":"none",
      "upgrade-insecure-requests":"1",
      "user-agent":USER_AGENT,
    },
    redirect:"follow",
    signal:AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("non-html response");
  const text = await response.text();
  if (text.length > 5000000) throw new Error("search response too large");
  return text;
}

const GENERAL_STORE_IDS = new Set(["aliexpress-cn","temu-global","walmart-us"]);
const CATEGORY_NEIGHBORS = {
  phone:["tablet","accessory"], tablet:["phone","laptop","accessory"], laptop:["desktop","monitor","accessory"],
  desktop:["laptop","monitor","accessory"], monitor:["desktop","laptop","accessory"], audio:["accessory","phone"],
  camera:["accessory"], tv:["appliance","audio"], console:["game","accessory"], game:["console","accessory"],
  clothing:["shoes","bag"], shoes:["clothing","sports","bag"], bag:["clothing","shoes"],
  beauty:["perfume"], perfume:["beauty"], jewelry:["watch"], watch:["jewelry"],
  furniture:["home","kitchen","office"], home:["furniture","kitchen"], kitchen:["home","furniture"],
  sports:["shoes","clothing"], toy:["baby","home"], baby:["toy"], office:["home","furniture"],
  grocery:["beauty","baby"], pet:["grocery"], appliance:["home","kitchen"], other:[],
};

function routeScore(store, intent, normalizedQuery) {
  const reasons = [];
  let score = 0;
  const category = intent.category || "other";
  const exactCategory = store.categories.includes(category);
  const neighbors = new Set(CATEGORY_NEIGHBORS[category] || []);
  const adjacentCategory = store.categories.some((item) => neighbors.has(item));
  const broad = store.categories.includes("*");
  const explicitBrand = (store.brands || []).some((brand) => (" " + normalizedQuery + " ").includes(" " + brand + " "));

  if (explicitBrand) { score += 120; reasons.push("brand"); }
  if (exactCategory) { score += 65; reasons.push("category"); }
  else if (adjacentCategory) { score += 24; reasons.push("adjacent_category"); }
  if (broad) { score += 32; reasons.push("general_marketplace"); }
  if (store.countryCode === "SA") { score += 18; reasons.push("saudi_first"); }
  if (GENERAL_STORE_IDS.has(store.id)) score += 8;

  // Unknown/general queries should still have useful broad-market coverage,
  // but specialist stores are not queried just to fill a quota.
  if (category === "other" && !explicitBrand) {
    if (broad) score += 30;
    else if (store.categories.includes("other")) { score += 12; reasons.push("general_specialist"); }
  }

  return { score, reasons, exactCategory, explicitBrand, broad };
}

export function routeFreeStorefronts(query) {
  const normalizedQuery = normalizeSearchQuery(query);
  const intent = parseSearchIntent(normalizedQuery);
  const routed = STORES
    .map((store) => {
      const base = routeScore(store, intent, normalizedQuery);
      const health = sourceReliability.view(store.id);
      const skippedForCooldown = sourceReliability.shouldSkip(store.id, { explicit: base.explicitBrand });
      return {
        store,
        ...base,
        score: base.score + health.adjustment,
        reliability: health,
        skippedForCooldown,
      };
    })
    .filter((entry) => entry.score > 0 && !entry.skippedForCooldown)
    .sort((a,b) =>
      b.score - a.score ||
      b.reliability.reliability - a.reliability.reliability ||
      Number(b.store.countryCode === "SA") - Number(a.store.countryCode === "SA") ||
      a.store.id.localeCompare(b.store.id)
    );

  // For a recognized category, require specialist/broad relevance. For an unknown
  // category, keep only general stores and stores explicitly named by the shopper.
  const relevant = routed.filter((entry) =>
    intent.category
      ? (entry.exactCategory || entry.broad || entry.explicitBrand || entry.reasons.includes("adjacent_category"))
      : (entry.broad || entry.explicitBrand || entry.reasons.includes("general_specialist"))
  );

  return relevant.map((entry, index) => ({
    ...entry,
    rank:index + 1,
    category:intent.category || null,
    brand:intent.brand || null,
  }));
}

export function selectedStores(query) {
  return routeFreeStorefronts(query).map((entry) => entry.store);
}

export async function searchFreeStorefrontById(storeId, query, options = {}) {
  const store = STORES.find((entry) => entry.id === storeId);
  if (!store) throw new Error("unknown storefront: " + storeId);
  const requestedPerStore = Number(options.perStore);
  const perStore = Number.isFinite(requestedPerStore) && requestedPerStore > 0 ? requestedPerStore : Infinity;
  return searchStore(store, query, perStore);
}

async function searchStore(store, query, perStore = Infinity) {
  const started = Date.now();
  const searchUrl = store.search(query);
  try {
    const html = await fetchText(searchUrl);
    const links = extractProductLinks(html, searchUrl, store, query, perStore);
    const settled = await Promise.allSettled(links.map((candidate) => resolveProductUrl(candidate.url)));
    const offers = settled
      .filter((result) => result.status === "fulfilled" && Number.isFinite(result.value?.productPrice))
      .map((result) => ({
        ...result.value,
        provider:"free-storefronts",
        providerMarket:store.id,
        merchant:result.value.merchant || store.name,
        merchantCountryCode:store.countryCode,
        merchantCountryNameAr:store.countryNameAr,
        canShipToSaudi:store.countryCode === "SA" ? true : result.value.canShipToSaudi,
        isLocal:store.countryCode === "SA",
        exactMatch:false,
        matchConfidence:0,
        sourceMeta:{
          ...(result.value.sourceMeta || {}),
          storefrontSearch:store.name,
          freeDiscovery:true,
          searchUrl,
        },
      }));
    const failures = settled.filter((result) => result.status === "rejected").length;
    const verificationBlocked = links.length > 0 && offers.length === 0 && failures === links.length;
    sourceReliability.record(store.id, {
      transportOk: !verificationBlocked,
      offers: offers.length,
      latencyMs: Date.now() - started,
      relevant: true,
    });
    return {
      store,
      searchUrl,
      candidates:links.length,
      offers,
      failures,
    };
  } catch (error) {
    sourceReliability.record(store.id, {
      transportOk:false,
      offers:0,
      latencyMs:Date.now() - started,
      relevant:true,
    });
    throw error;
  }
}

export function configuredFreeStorefronts() {
  return STORES.map(({id,name,countryCode,countryNameAr}) => ({id,name,countryCode,countryNameAr}));
}

export async function searchFreeStorefronts(query, options = {}) {
  const routes = routeFreeStorefronts(query);
  const stores = routes.map((entry) => entry.store);
  const requestedPerStore = Number(options.perStore);
  const perStore = Number.isFinite(requestedPerStore) && requestedPerStore > 0
    ? requestedPerStore
    : Infinity;
  const settled = await Promise.allSettled(stores.map((store) => searchStore(store, query, perStore)));
  const offers = [];
  const errors = [];
  const diagnostics = [];

  settled.forEach((result, index) => {
    const store = stores[index];
    if (result.status === "fulfilled") {
      offers.push(...result.value.offers);
      diagnostics.push({ store:store.id, routeRank:routes[index]?.rank, routeScore:routes[index]?.score, routeReasons:routes[index]?.reasons || [], reliability:sourceReliability.view(store.id), candidates:result.value.candidates, verifiedOffers:result.value.offers.length, failures:result.value.failures });
      if (!result.value.offers.length) errors.push({ market:store.id, error:"No verified structured-price product pages found" });
    } else {
      errors.push({ market:store.id, error:result.reason?.message || String(result.reason) });
      diagnostics.push({ store:store.id, routeRank:routes[index]?.rank, routeScore:routes[index]?.score, routeReasons:routes[index]?.reasons || [], reliability:sourceReliability.view(store.id), candidates:0, verifiedOffers:0, failures:1 });
    }
  });

  return {
    provider:"free-storefronts",
    ok:offers.length > 0,
    searchedMarkets:stores.map(({id,countryCode,countryNameAr}) => ({id,countryCode,countryNameAr})),
    offers,
    errors,
    diagnostics,
  };
}
