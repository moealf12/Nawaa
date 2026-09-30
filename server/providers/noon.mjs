const NOON_SEARCH_BASE = "https://www.noon.com/_vs/nc/mp-customer-catalog-api/api/v3/u/search/";

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

function productUrl(hit = {}) {
  const path = text(hit.pdp_url || hit.url);
  if (!path) return null;
  if (/^https:\/\//i.test(path)) return path;
  const normalized = path.startsWith("/") ? path : "/" + path;
  return "https://www.noon.com/saudi-en" + normalized;
}

function nudgeTexts(hit = {}) {
  return Array.isArray(hit.nudges)
    ? hit.nudges.map((item) => text(item?.text)).filter(Boolean)
    : [];
}

export function parseNoonCatalogPayload(payload, limit = 32) {
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
      providerMarket: "noon-sa",
      merchant: "noon",
      merchantCountryCode: "SA",
      merchantCountryNameAr: "السعودية",
      sourceUrl: productUrl(hit),
      image: text(hit?.image_url) || text(hit?.image_urls?.[0]) || null,
      title,
      condition: conditionFromTitle(title),
      availability: hit?.is_buyable === false ? "out_of_stock" : hit?.is_buyable === true ? "in_stock" : "unknown",
      canShipToSaudi: true,
      productPrice,
      originalProductPrice: productPrice,
      listPrice: regularPrice,
      shipping: freeDelivery ? 0 : null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      discount: regularPrice !== null && productPrice < regularPrice ? regularPrice - productPrice : 0,
      currency: "SAR",
      originalCurrency: "SAR",
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "incomplete",
      isLocal: true,
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

  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "accept-language": "en-SA,en;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.5; +https://moealf12.github.io/Nawaa/)",
        "x-platform": "web",
        "x-cms": "v2",
        "x-content": "desktop",
        "x-locale": "en-sa",
        referer: "https://www.noon.com/saudi-en/search/?q=" + encodeURIComponent(query),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    const cause = error?.cause;
    const detail = [
      error?.message,
      cause?.code,
      cause?.errno,
      cause?.syscall,
      cause?.hostname,
    ].filter(Boolean).join(" | ");
    throw new Error("noon-catalog fetch: " + (detail || String(error)));
  }

  if (!response.ok) throw new Error("noon-catalog: HTTP " + response.status);

  const payload = await response.json();
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
