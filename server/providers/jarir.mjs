import { randomUUID } from "node:crypto";

// Constructor index keys are public browser-side identifiers, not API tokens.
// Jarir exposes this English index key in its public storefront configuration.
const JARIR_CONSTRUCTOR_KEY = "key_KcSYfmQTEwRpBnd9";
const JARIR_CONSTRUCTOR_BASE = "https://ac.cnstrc.com/v1/search/";
const CLIENT_ID = randomUUID();

function decode(value = "") {
  return String(value)
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/");
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
  const match = String(tag).match(new RegExp("\\b" + escaped + "=[\\\"']([^\\\"']*)[\\\"']", "i"));
  return match ? decode(match[1]) : null;
}

function firstImage(chunk, title) {
  const tags = String(chunk).match(/<img\b[^>]*>/gi) || [];
  const normalizedTitle = String(title || "").toLowerCase();
  for (const tag of tags) {
    const src = attr(tag, "src");
    if (!src) continue;
    const alt = String(attr(tag, "alt") || "").toLowerCase();
    if (alt && normalizedTitle && alt === normalizedTitle) return src;
  }
  return tags.length ? attr(tags[0], "src") : null;
}

function firstProductUrl(chunk, productId) {
  const links = String(chunk).match(/<a\b[^>]*>/gi) || [];
  for (const tag of links) {
    const href = attr(tag, "href");
    const id = attr(tag, "data-product-id");
    if (href && (!productId || id === productId) && /jarir\.com\/sa-en\//i.test(href)) return href;
  }
  return null;
}

function titlePart(title, pattern) {
  return String(title || "").split(",").map((x) => x.trim()).find((x) => pattern.test(x)) || null;
}

function processorFromTitle(title) {
  const parts = String(title || "").split(",").map((x) => x.trim()).filter(Boolean);
  return [...parts].reverse().find((part) => /\b(?:Apple\s+)?A\d+|Bionic|Snapdragon|Exynos|Dimensity/i.test(part)) || null;
}

function colorFromTitle(title) {
  const parts = String(title || "").split(",").map((x) => x.trim()).filter(Boolean);
  const storageIndex = parts.findIndex((part) => /\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i.test(part));
  const candidate = storageIndex >= 0 ? parts[storageIndex + 1] : null;
  if (!candidate || /^(?:4G|5G|LTE)$/i.test(candidate)) return null;
  return candidate;
}

function normalizeJarirConstructorResult(result) {
  const data = result?.data || {};
  const meta = data?.metadata || {};
  const id = String(data.id || data.sku || "").trim();
  const title = String(meta.name || result?.value || data.description || "").trim();
  const price = Number(data.price ?? meta.price);
  if (!id || !title || !Number.isFinite(price) || price <= 0) return null;

  const renewed = /\bRenewed\b/i.test(title) || /Renewed/i.test(String(meta.productcode_description || ""));
  const storage = meta.tsca || titlePart(title, /\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i);
  const color = meta.colo || meta.cofa || null;
  const network = titlePart(title, /^(?:4G|5G|LTE)$/i);
  const processor = processorFromTitle(title);
  const productPath = String(data.url || "").replace(/^\/+/, "");
  const image = data.image_url || (meta.akeneo_image ? "https://ak-asset.jarir.com/akeneo-prod/asset/" + meta.akeneo_image : null);
  const camera = String(meta.cars || "").trim() || null;
  const rearCamera = camera ? camera.split("/")[0]?.replace(/^Rear:\s*/i, "") || camera : null;
  const frontCamera = camera && /Front:/i.test(camera) ? camera.split("/").slice(1).join("/").replace(/^Front:\s*/i, "") : null;
  const observedAt = new Date().toISOString();

  return {
    provider: "jarir-constructor",
    providerMarket: "jarir-sa",
    merchant: "Jarir",
    merchantCountryCode: "SA",
    merchantCountryNameAr: "السعودية",
    sourceUrl: productPath ? "https://www.jarir.com/sa-en/" + productPath : "https://www.jarir.com/sa-en/",
    image,
    title,
    condition: renewed ? "renewed" : "new",
    availability: "unknown",
    canShipToSaudi: true,
    productPrice: price,
    originalProductPrice: price,
    shipping: null,
    importCost: 0,
    tax: null,
    mandatoryFees: 0,
    discount: 0,
    currency: "SAR",
    originalCurrency: "SAR",
    exactMatch: false,
    matchConfidence: 0,
    priceConfidence: "incomplete",
    isLocal: true,
    deliveryDays: null,
    observedAt,
    dataKind: "live",
    seller: { name: "Jarir", type: "retailer" },
    specs: {
      brand: meta.brand || null,
      series: meta.seri || meta.model || null,
      deviceType: meta.ptyp || meta.model || null,
      color,
      storage,
      ram: null,
      processor,
      screenSize: meta.scsz || null,
      screenType: meta.scty || null,
      network,
      operatingSystem: meta.opsy || meta.moos || null,
      rearCamera,
      frontCamera,
      battery: null,
      waterproof: null,
      sim: meta.nsim || null,
      modelNumber: meta.mpn || null,
      barcode: meta.bar_code1 || meta.bar_code2 || null,
    },
    sourceMeta: {
      productId: id,
      itemNumber: meta.item_number || null,
      productType: meta.productcode_description || null,
      parsedFrom: "jarir-constructor-search",
    },
  };
}

export function parseJarirConstructorPayload(payload, limit = 24) {
  const results = Array.isArray(payload?.response?.results) ? payload.response.results : [];
  return results.map(normalizeJarirConstructorResult).filter(Boolean).slice(0, limit);
}

export function parseJarirSearchHtml(html, limit = 24) {
  const source = String(html || "");
  const tileRe = /<div\b[^>]*class=["'][^"']*product-tile__item--spacer[^"']*["'][^>]*>/gi;
  const matches = [...source.matchAll(tileRe)];
  const offers = [];
  const seen = new Set();

  for (let index = 0; index < matches.length && offers.length < limit; index++) {
    const tag = matches[index][0];
    const productId = attr(tag, "data-cnstrc-item-id");
    const title = attr(tag, "data-cnstrc-item-name");
    const rawPrice = attr(tag, "data-cnstrc-item-price");
    const price = Number(String(rawPrice || "").replace(/,/g, ""));

    if (!productId || !title || !Number.isFinite(price) || price <= 0) continue;

    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    const chunk = source.slice(start, end);

    const sourceUrl = firstProductUrl(chunk, productId) || ("https://www.jarir.com/sa-en/catalogsearch/result/?q=" + encodeURIComponent(title));
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);

    const image = firstImage(chunk, title);
    const addToCart = /Add\s+to\s+Cart/i.test(chunk);
    const renewed = /\bRenewed\b/i.test(title);
    const observedAt = new Date().toISOString();

    offers.push({
      provider: "jarir-html-fallback",
      providerMarket: "jarir-sa",
      merchant: "Jarir",
      merchantCountryCode: "SA",
      merchantCountryNameAr: "السعودية",
      sourceUrl,
      image,
      title,
      condition: renewed ? "renewed" : "new",
      availability: addToCart ? "in_stock" : "unknown",
      canShipToSaudi: true,
      productPrice: price,
      originalProductPrice: price,
      shipping: null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      discount: 0,
      currency: "SAR",
      originalCurrency: "SAR",
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "incomplete",
      isLocal: true,
      deliveryDays: null,
      observedAt,
      dataKind: "live",
      seller: { name: "Jarir", type: "retailer" },
      specs: {
        brand: /\bApple\b/i.test(title) ? "Apple" : null,
        series: String(title).split(",")[0] || null,
        deviceType: String(title).split(",")[0] || null,
        color: colorFromTitle(title),
        storage: titlePart(title, /\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i),
        processor: processorFromTitle(title),
        network: titlePart(title, /^(?:4G|5G|LTE)$/i),
      },
      sourceMeta: {
        productId,
        addToCart,
        parsedFrom: "jarir-search-page",
      },
    });
  }

  return offers;
}

async function searchViaConstructor(query, limit) {
  const url = new URL(JARIR_CONSTRUCTOR_BASE + encodeURIComponent(query));
  url.searchParams.set("key", JARIR_CONSTRUCTOR_KEY);
  url.searchParams.set("section", "Products");
  url.searchParams.set("num_results_per_page", String(limit));
  url.searchParams.set("page", "1");
  url.searchParams.set("i", CLIENT_ID);
  url.searchParams.set("s", "1");
  url.searchParams.set("c", "cio-fe-web-nawaa");
  url.searchParams.set("origin_referrer", "https://www.jarir.com/sa-en/catalogsearch/result/");

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("jarir-constructor: HTTP " + response.status);

  const payload = await response.json();
  return parseJarirConstructorPayload(payload, limit);
}

async function searchViaHtml(query, limit) {
  const url = "https://www.jarir.com/sa-en/catalogsearch/result/?q=" + encodeURIComponent(query);
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.4; +https://moealf12.github.io/Nawaa/)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("jarir-html: HTTP " + response.status);
  const html = await response.text();
  if (html.length > 10000000) throw new Error("jarir-html: response too large");
  return parseJarirSearchHtml(html, limit);
}

export async function searchJarir(query, limit = 24) {
  const capped = Math.max(1, Math.min(48, limit));
  const errors = [];

  try {
    const offers = await searchViaConstructor(query, capped);
    if (offers.length) {
      return {
        provider: "jarir-direct",
        ok: true,
        searchedMarkets: [{ id: "jarir-sa", countryCode: "SA", countryNameAr: "السعودية" }],
        offers,
        errors: [],
      };
    }
    errors.push({ market: "jarir-sa", error: "Constructor returned no products" });
  } catch (error) {
    errors.push({ market: "jarir-sa", error: error?.message || String(error) });
  }

  try {
    const offers = await searchViaHtml(query, capped);
    if (offers.length) {
      return {
        provider: "jarir-direct",
        ok: true,
        searchedMarkets: [{ id: "jarir-sa", countryCode: "SA", countryNameAr: "السعودية" }],
        offers,
        errors,
      };
    }
    errors.push({ market: "jarir-sa", error: "HTML fallback returned no products" });
  } catch (error) {
    errors.push({ market: "jarir-sa", error: error?.message || String(error) });
  }

  return {
    provider: "jarir-direct",
    ok: false,
    searchedMarkets: [{ id: "jarir-sa", countryCode: "SA", countryNameAr: "السعودية" }],
    offers: [],
    errors,
  };
}
