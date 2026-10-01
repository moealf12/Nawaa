import { resolveProductUrl } from "../url-resolver.mjs";
import { normalizeSearchQuery, parseSearchIntent } from "../../src/search-query.mjs";

const USER_AGENT = "Mozilla/5.0 (compatible; NAWAA-Free-Discovery/1.0; +https://moealf12.github.io/Nawaa/)";

const STORES = [
  {
    id:"shein-sa", name:"SHEIN", countryCode:"SA", countryNameAr:"السعودية", categories:["clothing","shoes","bag","beauty","jewelry","home","toy"],
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
    id:"ikea-sa", name:"IKEA Saudi", countryCode:"SA", countryNameAr:"السعودية", categories:["furniture","home","kitchen"],
    search:(q)=>"https://www.ikea.com/sa/en/search/?q="+encodeURIComponent(q),
    productPath:/\/p\/[^?#]+-\d+(?:[/?#]|$)/i,
  },
  {
    id:"asos-global", name:"ASOS", countryCode:"GB", countryNameAr:"بريطانيا", categories:["clothing","shoes","bag","beauty"],
    search:(q)=>"https://www.asos.com/search/?q="+encodeURIComponent(q),
    productPath:/\/prd\/\d+(?:[/?#]|$)/i,
  },
  {
    id:"farfetch-sa", name:"Farfetch", countryCode:"GB", countryNameAr:"بريطانيا", categories:["clothing","shoes","bag","jewelry","watch"],
    search:(q)=>"https://www.farfetch.com/sa/shopping/items.aspx?q="+encodeURIComponent(q),
    productPath:/\/shopping\/[^?#]+\/item-\d+\.aspx(?:[?#]|$)/i,
  },
  {
    id:"etsy-global", name:"Etsy", countryCode:"US", countryNameAr:"الولايات المتحدة", categories:["jewelry","clothing","bag","home","toy","other"],
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
    id:"adidas-sa", name:"adidas Saudi", countryCode:"SA", countryNameAr:"السعودية", categories:["clothing","shoes","sports","bag"],
    search:(q)=>"https://www.adidas.sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/[A-Z0-9_-]+\.html(?:[?#]|$)/i,
  },
  {
    id:"nike-sa", name:"Nike Saudi", countryCode:"SA", countryNameAr:"السعودية", categories:["clothing","shoes","sports","bag"],
    search:(q)=>"https://www.nike.sa/en/search?q="+encodeURIComponent(q),
    productPath:/\/[^?#]+(?:[?#].*)?$/i,
  },
  {
    id:"sephora-sa", name:"Sephora Saudi", countryCode:"SA", countryNameAr:"السعودية", categories:["beauty","perfume"],
    search:(q)=>"https://www.sephora.me/sa-en/search?q="+encodeURIComponent(q),
    productPath:/\/p\/[^?#]+(?:[?#]|$)/i,
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

function sameHost(candidate, base) {
  try {
    const a = new URL(candidate);
    const b = new URL(base);
    const ah = a.hostname.toLowerCase().replace(/^www\./, "");
    const bh = b.hostname.toLowerCase().replace(/^www\./, "");
    return ah === bh || ah.endsWith("." + bh) || bh.endsWith("." + ah);
  } catch { return false; }
}

function extractProductLinks(html, searchUrl, store, query, limit = 5) {
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    let url;
    try { url = new URL(decodeHtml(match[1]), searchUrl).href; } catch { continue; }
    if (!sameHost(url, searchUrl) || !store.productPath.test(url)) continue;
    const label = stripHtml(match[2]);
    const haystack = normalizeSearchQuery(label + " " + url);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    const score = tokens.length ? hits / tokens.length : 0.5;
    if (score < 0.2 && tokens.length > 1) continue;
    url = url.split("#")[0];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label, score });
    if (out.length >= 40) break;
  }
  return out.sort((a,b) => b.score - a.score).slice(0, limit);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers:{
      accept:"text/html,application/xhtml+xml",
      "accept-language":"en-US,en;q=0.8,ar-SA;q=0.7",
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

function selectedStores(query, maxStores = 8) {
  const intent = parseSearchIntent(query);
  const category = intent.category || "other";
  const primary = STORES.filter((store) => store.categories.includes(category));
  const broad = STORES.filter((store) => store.categories.includes("*"));
  const fallback = STORES.filter((store) => !primary.includes(store) && !broad.includes(store));
  return [...primary, ...broad, ...fallback].slice(0, Math.max(1, Math.min(STORES.length, maxStores)));
}

async function searchStore(store, query, perStore = 3) {
  const searchUrl = store.search(query);
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
  return {
    store,
    searchUrl,
    candidates:links.length,
    offers,
    failures:settled.filter((result) => result.status === "rejected").length,
  };
}

export function configuredFreeStorefronts() {
  return STORES.map(({id,name,countryCode,countryNameAr}) => ({id,name,countryCode,countryNameAr}));
}

export async function searchFreeStorefronts(query, options = {}) {
  const stores = selectedStores(query, Number(options.maxStores || 8));
  const perStore = Math.max(1, Math.min(5, Number(options.perStore || 3)));
  const settled = await Promise.allSettled(stores.map((store) => searchStore(store, query, perStore)));
  const offers = [];
  const errors = [];
  const diagnostics = [];

  settled.forEach((result, index) => {
    const store = stores[index];
    if (result.status === "fulfilled") {
      offers.push(...result.value.offers);
      diagnostics.push({ store:store.id, candidates:result.value.candidates, verifiedOffers:result.value.offers.length, failures:result.value.failures });
      if (!result.value.offers.length) errors.push({ market:store.id, error:"No verified structured-price product pages found" });
    } else {
      errors.push({ market:store.id, error:result.reason?.message || String(result.reason) });
      diagnostics.push({ store:store.id, candidates:0, verifiedOffers:0, failures:1 });
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
