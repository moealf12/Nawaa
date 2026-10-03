import { resolveProductUrl } from "../url-resolver.mjs";
import { normalizeSearchQuery, parseSearchIntent, filterQueryOffers } from "../../src/search-query.mjs";
import { sourceReliability } from "../source-reliability.mjs";
import { moneyToSAR } from "../fx.mjs";

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
    search:(q)=>"https://www.temu.com/search_result.html?search_key="+encodeURIComponent(q)+"&search_method=user",
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
    productPath:/\/p\/(?!pl(?:[/?#]|$))[A-Z0-9-]+(?:[/?#]|$)/i,
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
    productPath:/\/(?:site\/[^?#]+\/\d+\.p|product\/[^?#]+\/[^/?#]+\/sku\/\d+)(?:[?#]|$)/i,
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

function searchPageDiagnostics(html, searchUrl, finalUrl = searchUrl) {
  const hrefs = [];
  const seen = new Set();
  const re = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(String(html || ""))) && hrefs.length < 12) {
    let url;
    try { url = new URL(decodeHtml(match[1]), searchUrl).href; } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    hrefs.push(url);
  }
  const source = String(html || "");
  const hintPatterns = {
    ip: /(?:\\u002F|\\\/|\/)ip(?:\\u002F|\\\/|\/)/gi,
    prd: /(?:\\u002F|\\\/|\/)prd(?:\\u002F|\\\/|\/)/gi,
    item: /(?:\\u002F|\\\/|\/)item(?:\\u002F|\\\/|\/)/gi,
    productId: /["']?(?:productId|product_id|goods_id|skuId)["']?\s*[:=]/gi,
    canonicalUrl: /["']?(?:canonicalUrl|productUrl|url)["']?\s*[:=]/gi,
  };
  const hints = Object.fromEntries(Object.entries(hintPatterns).map(([key, regex]) => [key, (source.match(regex) || []).length]));
  const structuredUrlSamples = [];
  const structuredUrlRe = /["'](?:canonicalUrl|productUrl|url)["']\s*:\s*["']([^"']+)["']/gi;
  while ((match = structuredUrlRe.exec(source)) && structuredUrlSamples.length < 8) {
    structuredUrlSamples.push(match[1]);
  }
  const productIdSamples = [];
  const productIdRe = /["'](?:productId|product_id|goods_id|skuId)["']\s*:\s*["']?([A-Za-z0-9_-]+)["']?/gi;
  while ((match = productIdRe.exec(source)) && productIdSamples.length < 8) {
    productIdSamples.push(match[1]);
  }
  let blockedReason = null;
  try {
    const requested = new URL(searchUrl);
    const final = new URL(finalUrl || searchUrl);
    const host = final.hostname.toLowerCase();
    if (host.endsWith("shein.com") && (
      /\/risk\/challenge/i.test(final.pathname) ||
      /captcha_type=|risk-id=|\/risk\/challenge/i.test(source)
    )) blockedReason = "shein_risk_challenge";
    if (host.endsWith("temu.com") && /\/search_result\.html/i.test(requested.pathname) && (
      /\/(?:login|c)\.html$/i.test(final.pathname) ||
      /"originUrl":"\\u002F(?:login|c)\.html"/i.test(source) ||
      /login_scene/i.test(final.search)
    )) blockedReason = "temu_search_redirect";
    if (host.endsWith("walmart.com") && /\/blocked(?:\/|$)/i.test(final.pathname)) blockedReason = "walmart_blocked";
  } catch {}
  return {
    htmlBytes:new TextEncoder().encode(source).byteLength,
    requestedUrl:searchUrl,
    finalUrl:finalUrl || searchUrl,
    blockedReason,
    hrefSamples:hrefs,
    hints,
    structuredUrlSamples,
    productIdSamples,
  };
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


const LANDMARK_BLOOMREACH = {
  "centrepoint-sa":{
    accountId:"7586",
    authKey:"afxfe9u8i2iwrxp4",
    domainKey:"centrepointstores",
    requestId:"7545662630568",
    host:"https://www.centrepointstores.com",
  },
  "maxfashion-sa":{
    accountId:"7585",
    authKey:"hcm9cb32yykxejee",
    domainKey:"maxfashion",
    requestId:"7545662630568",
    host:"https://www.maxfashion.com",
  },
};

const LANDMARK_ALGOLIA = {
  "centrepoint-sa":{
    appId:"LM8X36L8LA",
    apiKey:"889d60a488b9a65b7d1ba14716572255",
    index:"blc_prod_sa_cp_product",
    host:"https://www.centrepointstores.com",
  },
  "maxfashion-sa":{
    appId:"QNYHZLFWA8",
    apiKey:"a83ce90ce2870849c24015f7bee3355d",
    index:"blc_prod_sa_max_product",
    host:"https://www.maxfashion.com",
  },
};

export function parseLandmarkBloomreachPayload(payload, storeId) {
  const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
  return parseLandmarkAlgoliaPayload({ hits:docs }, storeId);
}

async function searchLandmarkBloomreach(storeId, query, limit = Infinity) {
  const config = LANDMARK_BLOOMREACH[storeId];
  if (!config) return [];
  const finiteLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
  const rows = Number.isFinite(finiteLimit) ? Math.max(1, Math.min(100, finiteLimit)) : 100;
  const all = [];
  const seen = new Set();
  let start = 0;
  let total = Infinity;

  while (start < total && all.length < finiteLimit) {
    const params = new URLSearchParams({
      account_id:config.accountId,
      auth_key:config.authKey,
      domain_key:config.domainKey,
      request_id:config.requestId,
      request_type:"search",
      search_type:"keyword",
      q:query,
      rows:String(rows),
      start:String(start),
      fl:"pid,title,price,sale_price,low_price,low_sale_price,url,thumb_image,brand,inStock",
      url:config.host + "/sa/en/search?q=" + encodeURIComponent(query),
    });
    const response = await fetch("https://core.dxpapi.com/api/v1/core/?" + params.toString(), {
      headers:{
        accept:"application/json",
        "user-agent":USER_AGENT,
      },
      signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
      throw new Error("Landmark Bloomreach HTTP " + response.status + (detail ? ": " + detail : ""));
    }
    const payload = await response.json();
    total = Math.max(0, Number(payload?.response?.numFound) || 0);
    const batch = parseLandmarkBloomreachPayload(payload, storeId);
    for (const item of batch) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      all.push(item);
      if (all.length >= finiteLimit) break;
    }
    if (batch.length === 0) break;
    start += rows;
  }
  return all;
}

export function parseLandmarkAlgoliaPayload(payload, storeId) {
  const config = LANDMARK_ALGOLIA[storeId];
  if (!config) return [];
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const offers = [];
  const seen = new Set();

  for (const hit of hits) {
    const productId = String(hit?.pid || hit?.sku || hit?.objectID || "").trim();
    const title = String(hit?.title || hit?.name?.en || hit?.description?.en || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const price = Number(hit?.sale_price ?? hit?.low_sale_price ?? hit?.price ?? hit?.low_price);
    const path = String(hit?.url || hit?.uri || "").trim();
    if (!productId || !title || !Number.isFinite(price) || price <= 0 || !path) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);

    let sourceUrl;
    try {
      const localizedPath = path.startsWith("/buy-") ? "/sa/en" + path : path;
      sourceUrl = new URL(localizedPath, config.host).href;
    } catch { continue; }

    const imageRaw = String(hit?.thumb_image || hit?.thumbnailImg || hit?.primaryAssetContentUrl || hit?.galleryImages?.[0]?.url || "").trim();
    let image = null;
    try { if (imageRaw) image = new URL(imageRaw, config.host).href; } catch {}

    offers.push({
      productId,
      title,
      image,
      price,
      currency:"SAR",
      sourceUrl,
      brand:String(hit?.brand || hit?.brandDisplayValue?.en || hit?.manufacturerNameAll?.[0] || "").trim() || null,
      inStock:hit?.inStock === 1 || hit?.inStock === true,
    });
  }

  return offers;
}

async function searchLandmarkAlgolia(storeId, query, limit = Infinity) {
  const config = LANDMARK_ALGOLIA[storeId];
  if (!config) return [];
  const app = config.appId.toLowerCase();
  const hosts = [
    app + "-dsn.algolia.net",
    app + ".algolia.net",
    app + "-1.algolianet.com",
    app + "-2.algolianet.com",
    app + "-3.algolianet.com",
  ];
  const all = [];
  const seen = new Set();
  const finiteLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Infinity;
  const hitsPerPage = Number.isFinite(finiteLimit) ? Math.max(1, Math.min(100, finiteLimit)) : 100;
  let page = 0;
  let nbPages = 1;

  const requestPage = async (pageNumber) => {
    const errors = [];
    for (const host of hosts) {
      const endpoint = "https://" + host + "/1/indexes/" + encodeURIComponent(config.index) + "/query";
      try {
        const response = await fetch(endpoint, {
          method:"POST",
          headers:{
            accept:"application/json",
            "content-type":"application/json",
            "x-algolia-application-id":config.appId,
            "x-algolia-api-key":config.apiKey,
            "user-agent":USER_AGENT,
          },
          body:JSON.stringify({
            query,
            page:pageNumber,
            hitsPerPage,
            attributesToRetrieve:["*"],
          }),
          signal:AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 220);
          errors.push(host + " HTTP " + response.status + (detail ? " " + detail : ""));
          continue;
        }
        return await response.json();
      } catch (error) {
        const detail = error instanceof Error
          ? (error.cause?.code ? error.message + " (" + error.cause.code + ")" : error.message)
          : String(error);
        errors.push(host + " " + detail);
      }
    }
    throw new Error("Landmark Algolia hosts failed: " + errors.join(" | "));
  };

  while (page < nbPages && all.length < finiteLimit) {
    const payload = await requestPage(page);
    nbPages = Math.max(1, Number(payload?.nbPages) || 1);
    for (const item of parseLandmarkAlgoliaPayload(payload, storeId)) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      all.push(item);
      if (all.length >= finiteLimit) break;
    }
    page += 1;
  }

  return all;
}

function extractAssignedJsonObject(source, marker, maxBytes = 5000000) {
  const text = String(source || "");
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const endLimit = Math.min(text.length, start + maxBytes);
  for (let i = start; i < endLimit; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function stableTemuProductUrl(rawUrl, productId) {
  if (!rawUrl) return "https://www.temu.com/goods.html?goods_id=" + encodeURIComponent(productId);
  try {
    const url = new URL(rawUrl, "https://www.temu.com");
    if (/-g-\d+\.html$/i.test(url.pathname)) {
      url.search = "";
      url.hash = "";
      return url.href;
    }
    if (/\/goods\.html$/i.test(url.pathname)) {
      const id = url.searchParams.get("goods_id") || url.searchParams.get("goodsId") || productId;
      url.search = "";
      url.searchParams.set("goods_id", id);
      url.hash = "";
      return url.href;
    }
    url.hash = "";
    return url.href;
  } catch {
    return "https://www.temu.com/goods.html?goods_id=" + encodeURIComponent(productId);
  }
}

export function extractTemuSearchOffers(html, query) {
  const raw =
    extractAssignedJsonObject(html, "window.rawData=") ||
    extractAssignedJsonObject(html, "window.rawData =");
  const list = Array.isArray(raw?.store?.goodsList) ? raw.store.goodsList : [];
  const tokens = normalizeSearchQuery(query).split(" ").filter((token) => token.length >= 2);
  const offers = [];
  const seen = new Set();

  for (const entry of list) {
    const item = entry?.data && typeof entry.data === "object" ? entry.data : entry;
    if (!item || typeof item !== "object") continue;
    const productId = String(item.goodsId || item.goods_id || item.productId || "").trim();
    const title = String(item.title || item.goodsName || item.goods_name || "").replace(/\s+/g, " ").trim();
    const priceInfo = item.priceInfo || item.price_info || {};
    const rawPrice = Number(priceInfo.price ?? item.price);
    const currency = String(priceInfo.currency || item.currency || raw?.store?.localInfo?.currency || "").trim().toUpperCase();
    if (!productId || !title || !Number.isFinite(rawPrice) || rawPrice <= 0 || !currency) continue;

    const haystack = normalizeSearchQuery(title);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);

    // Temu search hydration reports the integer price in minor currency units.
    const price = rawPrice / 100;
    if (!Number.isFinite(price) || price <= 0) continue;

    const sourceUrl = stableTemuProductUrl(item.seoLinkUrl || item.linkUrl || item.url, productId);
    const imageRaw = item.image?.url || item.imageUrl || item.image_url || null;
    let image = null;
    try { if (imageRaw) image = new URL(imageRaw, "https://www.temu.com").href; } catch {}

    offers.push({ productId, title, image, price, currency, sourceUrl });
  }
  return offers;
}

export function extractAliExpressSearchOffers(html, query) {
  const source = String(html || "");
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const starts = [];
  const marker = /{"redirectedId"/g;
  let markerMatch;
  while ((markerMatch = marker.exec(source))) starts.push(markerMatch.index);
  const offers = [];
  const seen = new Set();

  const decodeJsonString = (value = "") => {
    try { return JSON.parse('"' + value + '"'); } catch { return decodeHtml(value).replace(/\\u0026/gi, "&").replace(/\\//g, "/"); }
  };

  for (let n = 0; n < starts.length; n++) {
    const start = starts[n];
    const end = starts[n + 1] ?? Math.min(source.length, start + 30000);
    const block = source.slice(start, end);
    if (!/"itemType":"productV3"/.test(block)) continue;

    const productId = block.match(/"productId":"?(\d+)"?/)?.[1] || null;
    const titleRaw = block.match(/"title":{"displayTitle":"((?:\\.|[^"\\])*)"/)?.[1] || null;
    const imageRaw = block.match(/"image":{"imgUrl":"((?:\\.|[^"\\])*)"/)?.[1] || null;
    const priceBlock =
      block.match(/"salePrice":{[\s\S]{0,1200}?}/)?.[0] ||
      block.match(/"originalPrice":{[\s\S]{0,1200}?}/)?.[0] ||
      null;
    const currency = priceBlock?.match(/"currencyCode":"([A-Z]{3})"/)?.[1] || null;
    const price = Number(priceBlock?.match(/"minPrice":([0-9]+(?:\.[0-9]+)?)/)?.[1]);
    const sourceRaw = block.match(/"productDetailUrl":"((?:\\.|[^"\\])*)"/)?.[1] || null;

    if (!productId || !titleRaw || !currency || !Number.isFinite(price) || price <= 0 || !sourceRaw) continue;
    const title = decodeJsonString(titleRaw);
    const haystack = normalizeSearchQuery(title);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);

    let image = imageRaw ? decodeJsonString(imageRaw) : null;
    if (image?.startsWith("//")) image = "https:" + image;
    const sourceUrl = decodeJsonString(sourceRaw).replace(/&amp;/g, "&");
    offers.push({ productId, title, image, price, currency, sourceUrl });
  }
  return offers;
}



export function parseIkeaSikPayload(payload, query) {
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const primary = results.find((entry) => entry?.component === "PRIMARY_AREA");
  const items = Array.isArray(primary?.items) ? primary.items : [];
  const offers = [];
  const seen = new Set();

  for (const item of items) {
    if (item?.type !== "PRODUCT" || !item.product) continue;
    const product = item.product;
    const productId = String(product.itemNo || "").trim();
    const title = String(product.name || "").trim();
    const price = Number(product.salesPrice?.numeral);
    const currency = String(product.salesPrice?.currencyCode || "").toUpperCase();
    const sourceUrl = product.pipUrl ? new URL(product.pipUrl, "https://www.ikea.com").href : null;
    const image = product.mainImageUrl ? new URL(product.mainImageUrl, "https://www.ikea.com").href : null;

    if (!productId || !title || !Number.isFinite(price) || price <= 0 || !currency || !sourceUrl) continue;
    const haystack = normalizeSearchQuery([
      title,
      product.typeName,
      product.itemMeasureReferenceText,
      product.productDescription,
    ].filter(Boolean).join(" "));
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;
    if (seen.has(productId)) continue;
    seen.add(productId);
    offers.push({ productId, title, image, price, currency, sourceUrl });
  }
  return offers;
}

async function searchIkeaSik(query) {
  const endpoint = "https://sik.search.blue.cdtapps.com/sa/en/search?c=sr&v=20260727";
  const body = {
    searchParameters:{ input:query, type:"QUERY" },
    allowAutocorrect:true,
    isUserLoggedIn:false,
    isB2B:false,
    listingABTest:true,
    components:[
      {
        component:"PRIMARY_AREA",
        columns:2,
        types:{ main:"PRODUCT", breakouts:["PLANNER","CATEGORY","CONTENT","MATTRESS_WARRANTY","FINANCIAL_SERVICES"] },
        filterConfig:{ "subcategories-style":"tree-navigation", "max-num-filters":5, presetFilters:false },
        window:{ size:24, offset:0 },
        allVariants:false,
        forceFilterCalculation:true,
      },
      { component:"CONTENT_AREA", types:{ main:"CONTENT", breakouts:[] }, window:{ size:12, offset:0 } },
      { component:"RELATED_SEARCHES" },
      { component:"QUESTIONS_AND_ANSWERS" },
      { component:"STORES" },
      { component:"CATEGORIES" },
      { component:"SIMILAR_PRODUCTS" },
      { component:"SEARCH_SUMMARY" },
      { component:"PAGE_MESSAGES" },
      { component:"RELATED_CATEGORIES" },
      { component:"PRODUCT_GROUP" },
    ],
  };
  const response = await fetch(endpoint, {
    method:"POST",
    headers:{
      accept:"*/*",
      "content-type":"text/plain;charset=UTF-8",
      "Session-Id":"6f29f48b-5fc4-4d56-9c66-5fdd72aa2026",
      origin:"https://www.ikea.com",
      referer:"https://www.ikea.com/sa/en/search/",
      "user-agent":USER_AGENT,
    },
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
    throw new Error("IKEA SIK HTTP " + response.status + (detail ? ": " + detail : ""));
  }
  return parseIkeaSikPayload(await response.json(), query);
}

export function extractBestBuySearchOffers(html, query) {
  const source = String(html || "");
  const tokens = normalizeSearchQuery(query).split(" ").filter((t) => t.length >= 2);
  const offers = [];
  const seen = new Set();
  const priceRe = /"price":\{"customerPrice":([0-9]+(?:\.[0-9]+)?)[\s\S]{0,2200}?"skuId":"(\d+)"/g;
  let match;

  const decodeJsonString = (value = "") => {
    try { return JSON.parse('"' + value + '"'); } catch { return decodeHtml(value).replace(/\\"/g, '"').replace(/\\u0026/gi, "&").replace(/\\\//g, "/"); }
  };

  while ((match = priceRe.exec(source))) {
    const price = Number(match[1]);
    const sku = match[2];
    if (!Number.isFinite(price) || price <= 0 || seen.has(sku)) continue;

    const start = Math.max(0, match.index - 16000);
    const end = Math.min(source.length, match.index + 7000);
    const block = source.slice(start, end);

    const pdpMatches = [...block.matchAll(/"pdpUrl":"((?:\\.|[^"\\])+)"/g)]
      .map((item) => decodeJsonString(item[1]))
      .filter((url) => !/\/openbox(?:[/?#]|$)/i.test(url) && new RegExp("/sku/" + sku + "(?:[/?#]|$)", "i").test(url));
    const sourceUrl = pdpMatches.at(-1) || null;

    const nameMatches = [...block.matchAll(/"name":\{"short":"((?:\\.|[^"\\])*)"/g)];
    const title = nameMatches.length ? decodeJsonString(nameMatches.at(-1)[1]) : null;

    const imageMatches = [...block.matchAll(/"primaryImage":\{"piscesHref":"((?:\\.|[^"\\])*)"/g)];
    const image = imageMatches.length ? decodeJsonString(imageMatches.at(-1)[1]) : null;

    if (!sourceUrl || !title) continue;
    const haystack = normalizeSearchQuery(title);
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    if (tokens.length > 1 && hits / tokens.length < 0.2) continue;

    seen.add(sku);
    offers.push({ productId:sku, title, image, price, currency:"USD", sourceUrl });
  }

  return offers;
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
  for (const hydratedSource of [String(html || ""), decodeHtml(html)]) {
    const quotedUrlRe = /["']((?:https?:)?(?:\\?\/){1,2}[^"' <>\s]+)["']/gi;
    while ((match = quotedUrlRe.exec(hydratedSource))) addCandidate(match[1], "");

    const unicodeUrlRe = /["']((?:https?:)?(?:\\u002F){1,2}[^"'<>]+)["']/gi;
    while ((match = unicodeUrlRe.exec(hydratedSource))) addCandidate(match[1], "");

    // Some storefronts (notably Temu/SHEIN) hydrate product links under
    // structured keys without a leading slash, so the generic quoted-URL
    // scanner above cannot see them. Resolve those values relative to the
    // search URL and let the store-specific productPath validate them.
    const structuredUrlRe = /["'](?:canonicalUrl|productUrl|productDetailUrl|seoUrl|seoLinkUrl|linkUrl|url)["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/gi;
    while ((match = structuredUrlRe.exec(hydratedSource))) {
      const structuredUrl = decodeHtml(match[1])
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/");
      const rootedUrl = /^(?:https?:)?\/\//i.test(structuredUrl) || structuredUrl.startsWith("/")
        ? structuredUrl
        : "/" + structuredUrl;
      addCandidate(rootedUrl, "");
    }
  }

  if (store.id === "aliexpress-cn") {
    const productIdRe = /productIds(?:=|%3D|\\u003D)(\d{10,})/gi;
    while ((match = productIdRe.exec(String(html || "")))) {
      addCandidate("https://www.aliexpress.com/item/" + match[1] + ".html", query);
    }
  }
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
  return { html:text, finalUrl:response.url || url };
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
  return searchStore(store, query, perStore, options.matchingQuery || query);
}

async function searchStore(store, query, perStore = Infinity, matchingQuery = query) {
  const started = Date.now();
  const searchUrl = store.search(query);
  try {
    let html = "";
    let searchPageFinalUrl = searchUrl;
    let searchDiagnostics = null;
    let primarySearchOffers = [];
    let primarySearchError = null;
    if (store.id === "ikea-sa") {
      try { primarySearchOffers = await searchIkeaSik(query); }
      catch (error) { primarySearchError = error instanceof Error ? error.message : String(error); }
    } else if (LANDMARK_BLOOMREACH[store.id]) {
      try { primarySearchOffers = await searchLandmarkBloomreach(store.id, query, perStore); }
      catch (bloomError) {
        try { primarySearchOffers = await searchLandmarkAlgolia(store.id, query, perStore); }
        catch (algoliaError) {
          const a = bloomError instanceof Error ? bloomError.message : String(bloomError);
          const b = algoliaError instanceof Error ? algoliaError.message : String(algoliaError);
          primarySearchError = a + " | fallback: " + b;
        }
      }
    }
    if (!primarySearchOffers.length) {
      try {
        const page = await fetchText(searchUrl);
        html = page.html;
        searchPageFinalUrl = page.finalUrl || searchUrl;
        searchDiagnostics = searchPageDiagnostics(html, searchUrl, searchPageFinalUrl);
        if (searchDiagnostics?.blockedReason && !primarySearchError) {
          primarySearchError = "Storefront blocked: " + searchDiagnostics.blockedReason;
        }
      }
      catch (error) {
        if (!primarySearchError) throw error;
        // Preserve the real primary-provider failure (e.g. Algolia/SIK) instead
        // of hiding it behind a secondary storefront-page 403.
        return {
          store,
          searchUrl,
          candidates:0,
          offers:[],
          failures:1,
          diagnostics:{
            searchPage:null,
            primarySearchError,
            candidateSamples:[],
            failureSamples:[],
            unpricedSamples:[],
          },
        };
      }
    }
    const links = html ? extractProductLinks(html, searchUrl, store, query, perStore) : [];
    const directSearchOffers =
      primarySearchOffers.length ? primarySearchOffers :
      store.id === "aliexpress-cn" ? extractAliExpressSearchOffers(html, query) :
      store.id === "temu-global" ? extractTemuSearchOffers(html, query) :
      store.id === "bestbuy-us" ? extractBestBuySearchOffers(html, query) :
      [];
    const resolutionLinks = directSearchOffers.length ? [] : links;
    const settled = await Promise.allSettled(resolutionLinks.map((candidate) => resolveProductUrl(candidate.url)));
    const resolvedOffers = settled
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
    const directOffers = (await Promise.all(directSearchOffers.map(async (item) => {
      const converted = await moneyToSAR(item.price, item.currency).catch(() => null);
      if (!converted) return null;
      return {
        provider:"free-storefronts",
        providerMarket:store.id,
        merchant:store.name,
        merchantCountryCode:store.countryCode,
        merchantCountryNameAr:store.countryNameAr,
        canShipToSaudi:store.countryCode === "SA" ? true : null,
        isLocal:store.countryCode === "SA",
        exactMatch:false,
        matchConfidence:0.9,
        sourceUrl:item.sourceUrl,
        image:item.image,
        title:item.title,
        specs:{ modelNumber:item.productId },
        condition:"new",
        availability:"unknown",
        productPrice:converted.value,
        originalProductPrice:item.price,
        shipping:null,
        importCost:null,
        tax:null,
        mandatoryFees:0,
        discount:0,
        currency:"SAR",
        originalCurrency:item.currency,
        deliveryDays:null,
        observedAt:new Date().toISOString(),
        dataKind:"live",
        fx:{ rate:converted.rate, source:converted.source, observedAt:converted.observedAt },
        sourceMeta:{ storefrontSearch:store.name, freeDiscovery:true, searchUrl, searchPageStructuredPrice:true },
      };
    }))).filter(Boolean);
    const {offers,queryFilter} = filterQueryOffers(matchingQuery, [...directOffers, ...resolvedOffers]);
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
      candidates:directSearchOffers.length || links.length,
      offers,
      failures,
      diagnostics:{
        queryFilter,
        searchPage:searchDiagnostics || (html ? searchPageDiagnostics(html, searchUrl, searchPageFinalUrl) : null),
        primarySearchError,
        candidateSamples:(directSearchOffers.length
          ? directSearchOffers.slice(0,5).map((item)=>item.sourceUrl)
          : links.slice(0,5).map((candidate)=>candidate.url)),
        failureSamples:settled
          .map((result,index)=>({result,candidate:resolutionLinks[index]}))
          .filter(({result})=>result.status === "rejected")
          .slice(0,5)
          .map(({result,candidate})=>({
            url:candidate?.url || null,
            error:result.reason instanceof Error ? result.reason.message : String(result.reason || "resolution_failed"),
          })),
        unpricedSamples:settled
          .map((result,index)=>({result,candidate:resolutionLinks[index]}))
          .filter(({result})=>result.status === "fulfilled" && !Number.isFinite(result.value?.productPrice))
          .slice(0,3)
          .map(({result,candidate})=>({
            url:candidate?.url || null,
            title:result.value?.title || null,
            originalProductPrice:result.value?.originalProductPrice ?? null,
            originalCurrency:result.value?.originalCurrency || null,
            strategy:result.value?.extraction?.strategy || null,
            availableStrategies:result.value?.extraction?.availableStrategies || [],
            domainAdapterId:result.value?.extraction?.domainAdapterId || null,
          })),
      },
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
  const settled = await Promise.allSettled(stores.map((store) => searchStore(store, query, perStore, options.matchingQuery || query)));
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
