const SHARAF_ALGOLIA_APP_ID = "9KHJLG93J1";
const SHARAF_ALGOLIA_SEARCH_KEY = "e81d5b30a712bb28f0f1d2a52fc92dd0";
const SHARAF_ALGOLIA_INDEX = "saudi_index";
const SHARAF_ALGOLIA_URL =
  "https://" + SHARAF_ALGOLIA_APP_ID.toLowerCase() + "-dsn.algolia.net/1/indexes/" +
  encodeURIComponent(SHARAF_ALGOLIA_INDEX) + "/query";

function txt(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  return "";
}

function finite(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/SAR|SR|ر\.س|﷼/gi, "")
    .replace(/,/g, "")
    .replace(/[^0-9.\-]/g, "")
    .trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function firstString(hit, paths) {
  for (const path of paths) {
    let value = hit;
    for (const key of path.split(".")) value = value?.[key];
    const candidate = txt(value);
    if (candidate) return candidate;
  }
  return "";
}

function firstArrayString(hit, paths) {
  for (const path of paths) {
    let value = hit;
    for (const key of path.split(".")) value = value?.[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) return item.trim();
        if (item && typeof item === "object") {
          const candidate = txt(item.url || item.src || item.href || item.image);
          if (candidate) return candidate;
        }
      }
    }
  }
  return "";
}

function recursiveValues(node, keyPattern, depth = 0, out = []) {
  if (!node || depth > 5 || out.length > 80) return out;
  if (Array.isArray(node)) {
    for (const item of node) recursiveValues(item, keyPattern, depth + 1, out);
    return out;
  }
  if (typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node)) {
    if (keyPattern.test(key)) out.push({ key, value });
    if (value && typeof value === "object") recursiveValues(value, keyPattern, depth + 1, out);
  }
  return out;
}

function firstPrice(hit, keys) {
  for (const key of keys) {
    const direct = hit?.[key];
    const number = finite(direct);
    if (number !== null && number > 0) return number;
  }
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const candidates = recursiveValues(hit, /price/i);
  for (const candidate of candidates) {
    if (!wanted.has(String(candidate.key).toLowerCase())) continue;
    const number = finite(candidate.value);
    if (number !== null && number > 0) return number;
  }
  return null;
}

function normalizeUrl(value) {
  const url = txt(value);
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return "https://saudi.sharafdg.com" + (url.startsWith("/") ? url : "/" + url);
}

function normalizeImage(value) {
  const url = txt(value);
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return "https:" + url;
  return normalizeUrl(url);
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#8212;|&mdash;/gi, "—")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseTitle(title = "") {
  const value = stripHtml(title);
  const storage = txt(value.match(/\b\d+(?:\.\d+)?\s*(?:GB|TB)\b/i)?.[0]).replace(/\s+/g, " ");
  const ram = txt(value.match(/\b\d+(?:\.\d+)?\s*GB\s*(?:RAM)?\b/i)?.[0]);
  const network = txt(value.match(/\b(?:4G|5G|5\.5G|LTE)\b/i)?.[0]);
  const regionVersion = txt(value.match(/\b(?:Middle\s+East|International|Saudi|KSA)\s+Version\b/i)?.[0]);

  let model = "";
  const iphone = value.match(/\biPhone\s+(?:Air|\d+(?:\s+(?:Pro(?:\s+Max)?|Plus|Air))?)/i);
  const galaxy = value.match(/\bGalaxy\s+[A-Za-z0-9]+(?:\s+(?:Ultra|Plus|FE))?/i);
  if (iphone) model = iphone[0];
  else if (galaxy) model = galaxy[0];

  let color = "";
  const colors = [
    "Cosmic Orange","Deep Blue","Mist Blue","Titanium Grey","Titanium Gray",
    "Lavender","Sage","Silver","Black","White","Blue","Green","Purple","Pink","Orange","Gold","Grey","Gray"
  ];
  color = colors.find((candidate) => new RegExp("\\b" + candidate.replace(/ /g, "\\s+") + "\\b", "i").test(value)) || "";

  let sim = "";
  const simMatch = value.match(/\b(?:Nano\s*SIM\s*\+\s*eSIM|Dual\s*eSIM|eSIM\s*only|eSIM)\b/i);
  if (simMatch) sim = simMatch[0];

  return { storage, ram, network, regionVersion, model, color, sim };
}

function conditionFromText(value = "") {
  if (/\b(?:renewed|refurbished|refurb)\b/i.test(value)) return "renewed";
  if (/\bopen\s*box\b/i.test(value)) return "open_box";
  if (/\bused\b/i.test(value)) return "used";
  return "new";
}

function stockStatus(hit) {
  const explicit = firstString(hit, [
    "stock_status","availability","stockStatus","stock.status","inventory_status","product_stock_status"
  ]).toLowerCase();

  if (/out.?of.?stock|unavailable|sold.?out/.test(explicit)) return "out_of_stock";
  if (/in.?stock|available|instock/.test(explicit)) return "in_stock";

  for (const path of ["is_in_stock","in_stock","isAvailable","available"]) {
    let value = hit;
    for (const key of path.split(".")) value = value?.[key];
    if (value === true || value === 1 || value === "1") return "in_stock";
    if (value === false || value === 0 || value === "0") return "out_of_stock";
  }
  return "unknown";
}

function titleFromHit(hit) {
  return stripHtml(firstString(hit, [
    "post_title","name","title","product_name","productName","post_name","content.title"
  ]));
}

function skuFromHit(hit) {
  return firstString(hit, [
    "sku","product_sku","item_sku","productSku","product_id","productId","objectID"
  ]);
}

function urlFromHit(hit) {
  return normalizeUrl(firstString(hit, [
    "permalink","url","product_url","productUrl","post_url","link","content.url"
  ]));
}

function imageFromHit(hit) {
  const direct = firstString(hit, [
    "image","image_url","imageUrl","thumbnail","thumbnail_url","featured_image","featuredImage","images.0"
  ]);
  if (direct) return normalizeImage(direct);

  const arrayValue = firstArrayString(hit, ["images","gallery","image_urls","thumbnails"]);
  if (arrayValue) return normalizeImage(arrayValue);

  const imageCandidates = recursiveValues(hit, /^(?:image|image_url|imageUrl|thumbnail|src)$/i);
  for (const candidate of imageCandidates) {
    const value = txt(candidate.value);
    if (value && /(?:https?:\/\/|\/).+\.(?:jpe?g|png|webp)(?:\?|$)/i.test(value)) return normalizeImage(value);
  }
  return null;
}

function brandFromHit(hit, title) {
  const brand = firstString(hit, ["brand","brand_name","brandName","taxonomies.product_brand.0","attributes.brand"]);
  if (brand) return stripHtml(brand);
  if (/\bApple\b/i.test(title)) return "Apple";
  if (/\bSamsung\b/i.test(title)) return "Samsung";
  if (/\bHuawei\b/i.test(title)) return "Huawei";
  if (/\bHonor\b/i.test(title)) return "Honor";
  if (/\bXiaomi\b/i.test(title)) return "Xiaomi";
  return null;
}

function extractAttribute(hit, names) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  for (const [key, value] of Object.entries(hit || {})) {
    if (!normalizedNames.includes(key.toLowerCase())) continue;
    const direct = txt(value);
    if (direct) return stripHtml(direct);
  }

  const attrs = hit?.attributes || hit?.product_attributes || hit?.specifications;
  if (attrs && typeof attrs === "object") {
    for (const [key, value] of Object.entries(attrs)) {
      if (!normalizedNames.some((name) => key.toLowerCase().includes(name))) continue;
      if (Array.isArray(value)) {
        const candidate = value.map(txt).find(Boolean);
        if (candidate) return stripHtml(candidate);
      }
      const candidate = txt(value?.value ?? value);
      if (candidate) return stripHtml(candidate);
    }
  }
  return "";
}

export function parseSharafAlgoliaPayload(payload, limit = 32) {
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const offers = [];

  for (const hit of hits) {
    if (offers.length >= limit) break;

    const title = titleFromHit(hit);
    const sku = skuFromHit(hit);
    const price = firstPrice(hit, ["sale_price","selling_price","final_price","price","current_price"]);
    const regularPrice = firstPrice(hit, ["regular_price","list_price","was_price","original_price"]);

    if (!title || !sku || price === null) continue;

    const parsed = parseTitle(title);
    const brand = brandFromHit(hit, title);
    const explicitColor = extractAttribute(hit, ["color","colour"]);
    const explicitStorage = extractAttribute(hit, ["storage","capacity","internal_memory"]);
    const explicitRam = extractAttribute(hit, ["ram","memory_ram"]);
    const explicitScreen = extractAttribute(hit, ["screen_size","display_size"]);
    const explicitOs = extractAttribute(hit, ["operating_system","os"]);
    const explicitProcessor = extractAttribute(hit, ["processor","chipset"]);
    const explicitRearCamera = extractAttribute(hit, ["rear_camera","primary_camera"]);
    const explicitFrontCamera = extractAttribute(hit, ["front_camera","secondary_camera"]);

    const url = urlFromHit(hit);
    const availability = stockStatus(hit);
    const observedAt = new Date().toISOString();

    offers.push({
      provider: "sharafdg-algolia",
      providerMarket: "sharafdg-sa",
      merchant: "Sharaf DG",
      merchantCountryCode: "SA",
      merchantCountryNameAr: "السعودية",
      sourceUrl: url,
      image: imageFromHit(hit),
      title,
      condition: conditionFromText(title),
      availability,
      canShipToSaudi: true,
      productPrice: price,
      originalProductPrice: price,
      listPrice: regularPrice,
      shipping: null,
      importCost: 0,
      tax: null,
      mandatoryFees: 0,
      discount: regularPrice !== null && regularPrice > price ? regularPrice - price : 0,
      currency: "SAR",
      originalCurrency: "SAR",
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "incomplete",
      isLocal: true,
      deliveryDays: null,
      observedAt,
      dataKind: "live",
      seller: { name: "Sharaf DG", type: "retailer" },
      specs: {
        brand,
        series: parsed.model || null,
        deviceType: parsed.model || null,
        color: explicitColor || parsed.color || null,
        storage: explicitStorage || parsed.storage || null,
        ram: explicitRam || null,
        processor: explicitProcessor || null,
        screenSize: explicitScreen || null,
        screenType: null,
        network: parsed.network || null,
        sim: parsed.sim || null,
        operatingSystem: explicitOs || null,
        rearCamera: explicitRearCamera || null,
        frontCamera: explicitFrontCamera || null,
        battery: extractAttribute(hit, ["battery","battery_capacity"]) || null,
        waterproof: extractAttribute(hit, ["waterproof","water_resistance"]) || null,
        modelNumber: firstString(hit, ["model_number","modelNumber","mpn"]) || sku,
        barcode: firstString(hit, ["barcode","gtin","ean","upc"]) || null,
        regionVersion: parsed.regionVersion || null,
      },
      sourceMeta: {
        productId: sku,
        algoliaObjectId: txt(hit?.objectID) || null,
        regionVersion: parsed.regionVersion || null,
        sim: parsed.sim || null,
        stockStatus: firstString(hit, ["stock_status","availability","stockStatus"]) || null,
        parsedFrom: "sharafdg-algolia",
      },
    });
  }

  return offers;
}

export async function searchSharafDG(query, limit = 32) {
  let response;
  try {
    response = await fetch(SHARAF_ALGOLIA_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-algolia-application-id": SHARAF_ALGOLIA_APP_ID,
        "x-algolia-api-key": SHARAF_ALGOLIA_SEARCH_KEY,
        "user-agent": "Mozilla/5.0 (compatible; NAWAA-Search/0.7; +https://moealf12.github.io/Nawaa/)",
      },
      body: JSON.stringify({
        query,
        hitsPerPage: Math.max(1, Math.min(48, limit)),
        page: 0,
        attributesToRetrieve: ["*"],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const cause = error?.cause;
    const detail = [error?.message, cause?.code, cause?.errno, cause?.syscall, cause?.hostname]
      .filter(Boolean).join(" | ");
    throw new Error("sharafdg-algolia fetch: " + (detail || String(error)));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error("sharafdg-algolia: HTTP " + response.status + (body ? " | " + body.slice(0, 300) : ""));
  }

  const payload = await response.json();
  const offers = parseSharafAlgoliaPayload(payload, limit);

  return {
    provider: "sharafdg-algolia",
    ok: offers.length > 0,
    searchedMarkets: [{ id: "sharafdg-sa", countryCode: "SA", countryNameAr: "السعودية" }],
    offers,
    errors: offers.length ? [] : [{
      market: "sharafdg-sa",
      error: "Algolia returned hits but no normalized offers",
      diagnostics: {
        nbHits: finite(payload?.nbHits),
        hitCount: Array.isArray(payload?.hits) ? payload.hits.length : 0,
        sampleKeys: Array.isArray(payload?.hits) && payload.hits[0]
          ? Object.keys(payload.hits[0]).slice(0, 40)
          : [],
      },
    }],
  };
}
