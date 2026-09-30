import https from "node:https";

const CARREFOUR_SEARCH_URL = "https://www.carrefourksa.com/mafrp/api/v1/search/listing/keyword";
const DEFAULT_SA_LOCATION = {
  latitude: "24.7136",
  longitude: "46.6753",
};

function postJsonHttp1(url, payload, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(url);
    const body = JSON.stringify(payload);
    const request = https.request(target, {
      method: "POST",
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(body),
      },
      ALPNProtocols: ["http/1.1"],
      timeout: 12000,
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;

      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= 3) return reject(new Error("carrefour-ksa: too many redirects"));
        const next = new URL(location, target);
        return resolve(postJsonHttp1(next, payload, headers, redirects + 1));
      }

      let size = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 12_000_000) {
          request.destroy(new Error("carrefour-ksa: response too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) {
          return reject(new Error("carrefour-ksa: HTTP " + status + (responseBody ? " | " + responseBody.slice(0, 300) : "")));
        }
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(new Error("carrefour-ksa: invalid JSON | " + (error?.message || String(error))));
        }
      });
    });

    request.on("timeout", () => request.destroy(new Error("carrefour-ksa: timeout")));
    request.on("error", (error) => {
      const detail = [error?.message, error?.code, error?.errno, error?.syscall, error?.hostname]
        .filter(Boolean).join(" | ");
      reject(new Error("carrefour-ksa http1: " + (detail || String(error))));
    });
    request.write(body);
    request.end();
  });
}

function txt(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function num(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseTitle(title = "") {
  const value = txt(title);
  const storage = txt(value.match(/\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i)?.[0]).replace(/\s+/g, " ");
  const ram = txt(value.match(/\b\d+(?:\.\d+)?\s*GB\s*RAM\b/i)?.[0]).replace(/\s*RAM\b/i, "").trim();
  const network = txt(value.match(/\b(?:4G|5G|5\.5G|LTE)\b/i)?.[0]);
  const regionVersion = txt(value.match(/\b(?:Middle\s+East|International|Saudi|KSA)\s+Version\b/i)?.[0]);

  let model = "";
  const iphone = value.match(/\biPhone\s+(?:Air|\d+(?:\s+(?:Pro(?:\s+Max)?|Plus|Air))?)/i);
  const galaxy = value.match(/\bGalaxy\s+[A-Za-z0-9]+(?:\s+(?:Ultra|Plus|FE))?/i);
  if (iphone) model = iphone[0];
  else if (galaxy) model = galaxy[0];

  let sim = "";
  const simParen = value.match(/\(([^)]*(?:SIM|eSIM)[^)]*)\)/i);
  if (simParen) sim = txt(simParen[1]);
  else if (/\beSIM\s*only\b/i.test(value)) sim = "eSIM only";
  else if (/\be\s*SIM\b/i.test(value)) sim = "eSIM";

  let color = "";
  if (storage) {
    const normalizedTitle = value.replace(/\s+/g, " ");
    const storageIndex = normalizedTitle.toLowerCase().indexOf(storage.toLowerCase());
    if (storageIndex >= 0) {
      let tail = normalizedTitle.slice(storageIndex + storage.length)
        .replace(/^\s*(?:Storage)?\s*[,/-]?\s*/i, "")
        .replace(/^\s*\d+\s*GB\s*RAM\s*[,/-]?\s*/i, "");
      const stop = tail.search(/\s*[,/]?\s*(?:4G|5G|5\.5G|LTE|Middle\s+East\s+Version|International\s+Version|eSIM|e\s*SIM)\b/i);
      if (stop > 0) color = txt(tail.slice(0, stop).replace(/^,+|,+$/g, ""));
    }
  }

  if (!color) {
    const colors = ["Black","White","Lavender","Sage","Silver","Deep Blue","Mist Blue","Blue","Gold","Grey","Gray","Purple","Pink","Orange","Titanium Grey"];
    color = colors.find((candidate) => new RegExp("\\b" + candidate.replace(/ /g, "\\s+") + "\\b", "i").test(value)) || "";
  }

  return { model, storage, ram, color, network, sim, regionVersion };
}

function collectProductCards(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectProductCards(item, out);
    return out;
  }

  if (node.uid === "master-product-card" && node.componentDTO?.additionalAttributes) {
    out.push(node.componentDTO);
    return out;
  }

  for (const value of Object.values(node)) collectProductCards(value, out);
  return out;
}

function productPriceFromCard(card = {}) {
  const attrs = card.additionalAttributes || {};
  const direct = num(attrs.sellingPrice);
  if (direct !== null && direct > 0) return direct;

  for (const component of card.productCardComponents || []) {
    const price = num(component?.componentDTO?.priceDTO?.finalPrice);
    if (price !== null && price > 0) return price;
  }
  return null;
}

function markedPriceFromCard(card = {}) {
  const attrs = card.additionalAttributes || {};
  const direct = num(attrs.markedPrice);
  if (direct !== null && direct > 0) return direct;
  return null;
}

function productUrl(path = "") {
  const value = txt(path);
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  return "https://www.carrefourksa.com" + (value.startsWith("/") ? value : "/" + value);
}

function stockStatus(attrs = {}) {
  const status = txt(attrs.stock?.stockLevelStatus).toLowerCase();
  if (/outofstock|out_of_stock|out of stock/.test(status)) return "out_of_stock";
  if (/instock|lowstock|in_stock|low_stock/.test(status)) return "in_stock";
  if (num(attrs.stock?.value) === 0) return "out_of_stock";
  if (num(attrs.stock?.value) > 0) return "in_stock";
  return "unknown";
}

export function parseCarrefourSearchPayload(payload, limit = 32) {
  const cards = collectProductCards(payload);
  const offers = [];
  const seen = new Set();

  for (const card of cards) {
    if (offers.length >= limit) break;
    const attrs = card.additionalAttributes || {};
    const id = txt(attrs.productId);
    const title = txt(attrs.productName);
    const price = productPriceFromCard(card);
    if (!id || !title || price === null) continue;

    const url = productUrl(attrs.productUrl);
    const dedupeKey = [id, attrs.offerId, attrs.shopName, price].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const specs = parseTitle(title);
    const markedPrice = markedPriceFromCard(card);
    const stock = stockStatus(attrs);
    const sellerName = txt(attrs.shopName) || "Carrefour";
    const observedAt = new Date().toISOString();

    offers.push({
      provider: "carrefour-ksa",
      providerMarket: "carrefour-sa",
      merchant: "Carrefour",
      merchantCountryCode: "SA",
      merchantCountryNameAr: "السعودية",
      sourceUrl: url,
      image: txt(attrs.imageUrl) || null,
      title,
      condition: /\b(?:renewed|refurbished)\b/i.test(title) ? "renewed" : "new",
      availability: stock,
      canShipToSaudi: true,
      productPrice: price,
      originalProductPrice: price,
      listPrice: markedPrice,
      shipping: null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      discount: markedPrice !== null && markedPrice > price ? markedPrice - price : 0,
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
        type: sellerName.toLowerCase() === "carrefour" ? "retailer" : "marketplace_seller",
      },
      specs: {
        brand: /\bApple\b/i.test(title) ? "Apple" : /\bSamsung\b/i.test(title) ? "Samsung" : null,
        series: specs.model || null,
        deviceType: specs.model || null,
        color: specs.color || null,
        storage: specs.storage || null,
        ram: specs.ram || null,
        processor: null,
        screenSize: null,
        screenType: null,
        network: specs.network || null,
        sim: specs.sim || null,
        operatingSystem: null,
        rearCamera: null,
        frontCamera: null,
        battery: null,
        waterproof: null,
        modelNumber: id,
        barcode: null,
        regionVersion: specs.regionVersion || null,
      },
      sourceMeta: {
        productId: id,
        offerId: txt(attrs.offerId) || null,
        productCompositeId: txt(attrs.productCompositeId) || null,
        sellerName,
        stockLevelStatus: txt(attrs.stock?.stockLevelStatus) || null,
        stockValue: num(attrs.stock?.value),
        intent: txt(attrs.intent) || null,
        shippingIndicator: txt(attrs.shippingIndicator) || null,
        isExpress: Boolean(attrs.isExpress),
        internationalShipping: Boolean(attrs.internationalShipping),
        regionVersion: specs.regionVersion || null,
        sim: specs.sim || null,
        locationBasis: "Saudi default catalog location",
        parsedFrom: "carrefour-search-bff",
      },
    });
  }

  return offers;
}

export async function searchCarrefour(query, limit = 32) {
  const body = {
    needOOSProducts: false,
    needVariantsData: false,
    verticalCategory: true,
    pageType: "SLP",
    keyword: query,
    currentPage: 0,
    pageSize: Math.max(1, Math.min(40, limit)),
    sortBy: "relevance",
    productCardType: "regular",
    requireSponsProducts: false,
  };

  const headers = {
    accept: "application/json",
    "content-type": "application/json; charset=utf-8",
    "accept-language": "en-SA,en;q=0.9",
    appId: "Reactweb",
    storeId: "mafsau",
    langCode: "en",
    lat: DEFAULT_SA_LOCATION.latitude,
    long: DEFAULT_SA_LOCATION.longitude,
    "x-maf-tenant": "mafsau",
    "x-maf-account": "carrefour",
    "x-maf-env": "prod",
    "web-view-type": "desktop-web",
    origin: "https://www.carrefourksa.com",
    referer: "https://www.carrefourksa.com/mafsau/en/",
    "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.6; +https://moealf12.github.io/Nawaa/)",
  };

  const payload = await postJsonHttp1(CARREFOUR_SEARCH_URL, body, headers);

  const offers = parseCarrefourSearchPayload(payload, limit);

  if (!offers.length) {
    throw new Error(
      "carrefour-ksa: no product cards | keys=" +
      Object.keys(payload || {}).slice(0, 12).join(",")
    );
  }

  return {
    provider: "carrefour-ksa",
    ok: true,
    searchedMarkets: [{ id: "carrefour-sa", countryCode: "SA", countryNameAr: "السعودية" }],
    offers,
    errors: [],
  };
}
