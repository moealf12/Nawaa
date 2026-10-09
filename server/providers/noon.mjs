import https from "node:https";

const NOON_SEARCH_BASE = "https://www.noon.com/_vs/nc/mp-customer-catalog-api/api/v3/u/search/";

export function noonConfigured() {
  return String(process.env.NOON_ENABLED || "").toLowerCase() === "true";
}

function getJsonHttp1(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(url);
    const request = https.get(target, {
      headers,
      ALPNProtocols: ["http/1.1"],
      timeout: 12000,
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= 3) return reject(new Error("noon-catalog: too many redirects"));
        const next = new URL(location, target);
        return resolve(getJsonHttp1(next, headers, redirects + 1));
      }

      if (status < 200 || status >= 300) {
        response.resume();
        return reject(new Error("noon-catalog: HTTP " + status));
      }

      let size = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 8_000_000) {
          request.destroy(new Error("noon-catalog: response too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error("noon-catalog: invalid JSON | " + (error?.message || String(error))));
        }
      });
    });

    request.on("timeout", () => request.destroy(new Error("noon-catalog: timeout")));
    request.on("error", (error) => {
      const detail = [
        error?.message,
        error?.code,
        error?.errno,
        error?.syscall,
        error?.hostname,
      ].filter(Boolean).join(" | ");
      reject(new Error("noon-catalog http1: " + (detail || String(error))));
    });
  });
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstPositive(...values) {
  for (const value of values) {
    const number = finite(value);
    if (number !== null && number > 0) return number;
  }
  return null;
}

function titleParts(title = "") {
  const storage = text(title.match(/\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i)?.[0]).replace(/\s+/g, " ");
  const network = text(title.match(/\b(?:4G|5G|5\.5G|LTE)\b/i)?.[0]);
  const sim = text(title.match(/\(([^)]*(?:SIM|eSIM)[^)]*)\)/i)?.[1]);
  const version = text(title.match(/-\s*([^,-]+?\s+Version)\s*$/i)?.[1]);

  let model = "";
  const iphone = title.match(/\biPhone\s+(?:Air|\d+(?:\s+(?:Pro(?:\s+Max)?|Plus|Air))?)/i);
  const galaxy = title.match(/\bGalaxy\s+[A-Za-z0-9]+(?:\s+[A-Za-z0-9]+){0,3}/i);
  if (iphone) model = iphone[0];
  else if (galaxy) model = galaxy[0];

  let color = "";
  if (sim) {
    const escaped = sim.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
    const match = title.match(new RegExp("\\(" + escaped + "\\)\\s+(.+?)\\s+(?:4G|5G|5\\.5G|LTE)\\b", "i"));
    color = text(match?.[1]);
  }
  if (!color && storage) {
    const storageEscaped = storage.replace(/\s+/g, "\\s*").replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
    const match = title.match(new RegExp(storageEscaped + "(?:\\s*\\([^)]*\\))?\\s+(.+?)\\s+(?:4G|5G|5\\.5G|LTE)\\b", "i"));
    color = text(match?.[1]);
  }

  return { storage, network, sim, version, model, color };
}

function conditionFromTitle(title = "") {
  if (/\b(?:renewed|refurbished|refurb)\b/i.test(title)) return "renewed";
  if (/\bopen\s*box\b/i.test(title)) return "open_box";
  if (/\bused\b/i.test(title)) return "used";
  return "new";
}

function productUrl(hit = {}, market = "SA") {
  const path = text(hit.pdp_url || hit.url);
  if (!path) return null;
  if (market === "AE") {
    // Reject cross-market or external catalog links. UAE offers must not be
    // attributed to Saudi Arabia or another merchant.
    try {
      const candidate = new URL(path, "https://www.noon.com/uae-en/");
      if (candidate.hostname !== "www.noon.com" || candidate.protocol !== "https:") return null;
      if (/^\/saudi-en\//i.test(candidate.pathname)) return null;
      if (!/^\/uae-en\//i.test(candidate.pathname)) {
        candidate.pathname = "/uae-en" + (candidate.pathname.startsWith("/") ? "" : "/") + candidate.pathname;
      }
      if (!/\/p\/?$/i.test(candidate.pathname)) {
        // Catalog hits can contain a slug rather than a full PDP.
        // Only a SKU in the same price-bearing hit can form a PDP.
        const sku = text(hit.sku || hit.catalog_sku || hit.sku_config);
        if (!/^[A-Z][A-Z0-9]{6,20}$/i.test(sku)) return null;
        candidate.pathname = candidate.pathname.replace(/\/+$/, "") + "/" + sku + "/p/";
      }
      candidate.search = ""; candidate.hash = "";
      return candidate.href;
    } catch { return null; }
  }
  if (/^https:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : "/" + path;
  return "https://www.noon.com/saudi-en" + normalized;
}

function nudgeTexts(hit = {}) {
  return Array.isArray(hit.nudges)
    ? hit.nudges.map((item) => text(item?.text)).filter(Boolean)
    : [];
}

export function parseNoonCatalogPayload(payload, limit = 32, market = "SA") {
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const offers = [];

  for (const hit of hits) {
    if (offers.length >= limit) break;

    const title = text(hit?.name);
    const sku = text(hit?.sku || hit?.sku_config || hit?.catalog_sku);
    const regularPrice = firstPositive(hit?.price);
    const salePrice = firstPositive(hit?.sale_price);
    const productPrice = salePrice !== null && (regularPrice === null || salePrice <= regularPrice)
      ? salePrice
      : regularPrice;

    if (!title || !sku || productPrice === null) continue;
    const declaredCurrency = text(hit?.currency || hit?.price_currency || hit?.priceCurrency).toUpperCase();
    if (market === "AE" && declaredCurrency && declaredCurrency !== "AED") continue;
    const url = productUrl(hit, market);
    if (market === "AE" && !url) continue;

    const parts = titleParts(title);
    const plp = hit?.plp_specifications && typeof hit.plp_specifications === "object"
      ? hit.plp_specifications
      : {};
    const nudges = nudgeTexts(hit);
    const flags = Array.isArray(hit?.flags) ? hit.flags.map(String) : [];
    const freeDelivery = flags.includes("free_delivery_eligible") ||
      nudges.some((item) => /free\s+delivery/i.test(item));
    const lowStock = finite(hit?.low_stock_nudge_value);
    const sellerName = text(hit?.store_name) || "noon";
    const sellerRating = finite(hit?.partner_ratings_sellerlab?.partner_rating);
    const sellerPositive = finite(hit?.partner_ratings_sellerlab?.positive_seller_rating);
    const observedAt = new Date().toISOString();

    offers.push({
      provider: "noon-catalog",
      providerMarket: market === "AE" ? "noon-ae" : "noon-sa",
      merchant: "noon",
      merchantCountryCode: market === "AE" ? "AE" : "SA",
      merchantCountryNameAr: market === "AE" ? "الإمارات" : "السعودية",
      sourceUrl: url,
      image: text(hit?.image_url) || text(hit?.image_urls?.[0]) || null,
      title,
      condition: conditionFromTitle(title),
      availability: hit?.is_buyable === false ? "out_of_stock" : hit?.is_buyable === true ? "in_stock" : "unknown",
      canShipToSaudi: market === "AE" ? null : true,
      productPrice,
      originalProductPrice: productPrice,
      listPrice: regularPrice,
      shipping: freeDelivery ? 0 : null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      advertisedDiscount: regularPrice !== null && productPrice < regularPrice ? regularPrice - productPrice : 0,
      discount: 0,
      currency: market === "AE" ? "AED" : "SAR",
      originalCurrency: market === "AE" ? "AED" : "SAR",
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "incomplete",
      isLocal: market !== "AE",
      deliveryDays: null,
      observedAt,
      dataKind: "live",
      seller: {
        name: sellerName,
        type: sellerName.toLowerCase() === "noon" ? "retailer" : "marketplace_seller",
        rating: sellerRating,
        positiveRating: sellerPositive,
      },
      specs: {
        brand: text(hit?.brand) || null,
        series: parts.model || null,
        deviceType: parts.model || null,
        color: parts.color || null,
        storage: parts.storage || null,
        ram: text(plp["RAM Size"]) || null,
        processor: null,
        screenSize: text(plp["Screen Size"]) || null,
        screenType: null,
        network: parts.network || null,
        sim: parts.sim || null,
        operatingSystem: null,
        rearCamera: null,
        frontCamera: text(plp["Secondary Camera Resolution"]) || null,
        battery: text(plp["Battery Size"]) || null,
        waterproof: null,
        modelNumber: sku || null,
        barcode: null,
        regionVersion: parts.version || null,
      },
      sourceMeta: {
        productId: sku,
        offerCode: text(hit?.offer_code) || null,
        catalogSku: text(hit?.catalog_sku) || null,
        sellerName,
        sellerRating,
        sellerPositiveRating: sellerPositive,
        freeDelivery,
        fulfilledByNoon: flags.includes("fbn"),
        lowStockCount: lowStock,
        bestseller: Boolean(hit?.is_bestseller),
        rating: finite(hit?.product_rating?.value),
        ratingCount: finite(hit?.product_rating?.count),
        nudges,
        regionVersion: parts.version || null,
        sim: parts.sim || null,
        parsedFrom: "noon-catalog-api",
      },
    });
  }

  return offers;
}

export async function searchNoon(query, limit = 32) {
  const url = new URL(NOON_SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.max(1, Math.min(50, limit))));
  url.searchParams.set("sort[by]", "popularity");
  url.searchParams.set("sort[dir]", "desc");

  const requestHeaders = {
    accept: "application/json",
    "accept-language": "en-SA,en;q=0.9",
    "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.5; +https://moealf12.github.io/Nawaa/)",
    "x-platform": "web",
    "x-cms": "v2",
    "x-content": "desktop",
    "x-locale": "en-sa",
    referer: "https://www.noon.com/saudi-en/search/?q=" + encodeURIComponent(query),
  };

  const payload = await getJsonHttp1(url, requestHeaders);

  const offers = parseNoonCatalogPayload(payload, limit);

  return {
    provider: "noon-catalog",
    ok: offers.length > 0,
    searchedMarkets: [{ id: "noon-sa", countryCode: "SA", countryNameAr: "السعودية" }],
    offers,
    errors: offers.length ? [] : [{
      market: "noon-sa",
      error: "No Noon catalog hits found",
      diagnostics: {
        type: payload?.type || null,
        nbHits: finite(payload?.nbHits),
        hitCount: Array.isArray(payload?.hits) ? payload.hits.length : 0,
      },
    }],
  };
}

export async function searchNoonUaeCatalog(query, limit = 32, {signal} = {}) {
  const url = new URL(NOON_SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.max(1, Math.min(50, Number(limit) || 32))));
  url.searchParams.set("sort[by]", "popularity");
  url.searchParams.set("sort[dir]", "desc");
  const headers = {
    accept: "application/json",
    "accept-language": "en-AE,en;q=0.9",
    "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.5; +https://moealf12.github.io/Nawaa/)",
    // Both country and locale are needed for market-specific results.
    "x-mp-country": "ae",
    "x-locale": "en-ae",
    referer: "https://www.noon.com/uae-en/search/?q=" + encodeURIComponent(query),
  };
  // UAE public catalog paths vary across Noon deployments. Try the
  // storefront's existing endpoint first; on transport failure or retired API
  // route, try the separate public _svc catalog. Never evade 401/403/429.
  // Both requests share ONE cancellation budget to bound customer latency.
  const budget = AbortSignal.timeout(4500);
  const requestSignal = signal ? AbortSignal.any([signal,budget]) : budget;
  const alternate = new URL("https://www.noon.com/_svc/catalog/api/v3/u/search");
  for (const [name,value] of url.searchParams) alternate.searchParams.set(name,value);
  const urls=[url,alternate];
  let payload;
  let lastError=null;
  for (let index=0;index<urls.length;index++) {
    requestSignal.throwIfAborted();
    try {
      const response=await fetch(urls[index],{headers,signal:requestSignal});
      if ([401,403,429].includes(response.status)) {
        throw new Error("Noon UAE catalog access denied: HTTP "+response.status);
      }
      if (!response.ok) {
        if (index+1<urls.length && [404,410,500,502,503,504].includes(response.status)) {
          lastError=new Error("Noon UAE catalog HTTP "+response.status);
          continue;
        }
        throw new Error("Noon UAE catalog HTTP "+response.status);
      }
      payload=await response.json();
      break;
    }catch(error){
      if (requestSignal.aborted || /access denied|HTTP (?:401|403|429)/.test(String(error?.message||""))) throw error;
      if (index+1>=urls.length) throw error;
      lastError=error;
    }
  }
  if (!payload) throw lastError || new Error("Noon UAE catalog unavailable");
  // A clearly Saudi response must never be relabelled as an AED offer.
  const describedMarket = [payload?.meta?.title, payload?.meta?.desc, payload?.market, payload?.country].filter(Boolean).join(" ");
  if (/saudi arabia|saudi-en|\bksa\b/i.test(describedMarket) && !/united arab emirates|\buae\b|dubai|abu dhabi/i.test(describedMarket)) {
    throw new Error("noon_uae_market_mismatch");
  }
  return parseNoonCatalogPayload(payload, Math.max(1, Math.min(50, Number(limit) || 32)), "AE");
}
