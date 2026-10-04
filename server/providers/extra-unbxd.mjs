const EXTRA_API_KEY = "21705619e273429e5767eea44ccb1ad5";
const EXTRA_SITE_KEY = "ss-unbxd-auk-extra-saudi-en-prod11541714990488";
const EXTRA_SEARCH_BASE = `https://search.unbxd.io/${EXTRA_API_KEY}/${EXTRA_SITE_KEY}/search`;

import { filterQueryOffers } from "../../src/search-query.mjs";

function firstFinite(...values) {
  for (const value of values) {
    if (value == null || typeof value === "boolean" || (typeof value === "string" && !value.trim())) continue;
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) return value[0].trim();
  }
  return null;
}

function absoluteMedia(value) {
  if (!value) return null;
  if (value.startsWith("//")) return "https:" + value;
  return value;
}

function boolish(value) {
  if (typeof value === "boolean") return value;
  const s = String(value || "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function normalizeProduct(product) {
  const id = String(
    product?._root_ ??
    product?.uniqueId ??
    product?.productId ??
    product?.id ??
    product?.code ??
    ""
  ).trim();

  const title = firstString(
    product?.name,
    product?.productName,
    product?.title,
    product?.autosuggest,
    product?.autosuggest_unstemmed
  );

  const price = firstFinite(
    product?.currentPrice,
    product?.sellingPrice,
    product?.specialPrice,
    product?.basicPriceValueDiscount,
    product?.priceValue,
    product?.price
  );

  const image = absoluteMedia(firstString(
    product?.imageUrl,
    product?.image,
    product?.amplienceProductBaseUrl
  ));

  if (!id || !title || price === null) return null;

  const available = boolish(product?.available);
  const homeDelivery = boolish(product?.homeDeliveryEnabled);
  const jeddahInStock = Array.isArray(product?.inStock)
    ? product.inStock.includes("SA-jeddah_inStock")
    : null;

  return {
    provider: "extra-unbxd",
    providerMarket: "extra-sa",
    merchant: "eXtra",
    merchantCountryCode: "SA",
    merchantCountryNameAr: "السعودية",
    sourceUrl: `https://www.extra.com/en-sa/p/${encodeURIComponent(id)}`,
    image,
    title,
    condition: "new",
    availability: available || jeddahInStock === true ? "in_stock" : "unknown",
    canShipToSaudi: homeDelivery || available ? true : null,
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
    observedAt: new Date().toISOString(),
    dataKind: "live",
    seller: { name: "eXtra", type: "retailer" },
    specs: {
      brand: firstString(product?.featureEnBrandName, product?.brandEn),
      series: firstString(product?.featureEnSeriesName),
      deviceType: firstString(product?.featureEnDeviceType),
      color: firstString(product?.featureEnColor),
      storage: firstString(product?.featureEnMemoryInternal),
      ram: firstString(product?.featureEnRAMSIZE),
      processor: firstString(product?.featureEnProcessor, product?.featureEnProcessorCore),
      screenSize: firstString(product?.featureEnScreenSizeInch),
      network: firstString(product?.featureEnNetwork),
      operatingSystem: firstString(product?.featureEnOperatingSystem),
      rearCamera: firstString(product?.featureEnRearCamera),
      battery: firstString(product?.featureEnBatterySizeMAH),
      waterproof: firstString(product?.featureEnWaterproofYN),
      modelNumber: firstString(product?.modelNumber),
      barcode: firstString(product?.barCode),
    },
    sourceMeta: {
      productId: id,
      nameAr: firstString(product?.nameAr),
      color: firstString(product?.featureEnColor),
      storage: firstString(product?.featureEnMemoryInternal),
      jeddahInStock,
      homeDeliveryEnabled: homeDelivery,
      collectFromStoreEnabled: boolish(product?.collectFromStoreEnabled),
      onlineOnly: boolish(product?.isOnlineOnly),
    },
  };
}

export async function searchExtraUnbxd(query, limit = 12, matchingQuery = query) {
  const cap = limit === Infinity ? Infinity : Math.max(1, Number(limit) || 12);
  const url = new URL(EXTRA_SEARCH_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("rows", String(Math.min(100, cap)));
  url.searchParams.set("format", "json");
  const signal = AbortSignal.timeout(6500);
  const products = [], seen = new Set(), errors = [];
  let start = 0, total = null, complete = false;
  while(products.length < cap) {
    url.searchParams.set("start", String(start));
    try {
      const response = await fetch(url, {headers:{accept:"application/json"},signal});
      if(!response.ok) throw new Error("extra-unbxd: HTTP " + response.status);
      const data = await response.json();
      const page = data?.response?.products;
      if(!Array.isArray(page)) throw new Error("extra-unbxd: Malformed product response");
      const count = data.response.numberOfProducts;
      if(Number.isFinite(Number(count)) && count != null) total = Number(count);
      let added = 0;
      for(const product of page) {
        const offer = normalizeProduct(product);
        if(!offer || seen.has(offer.sourceUrl)) continue;
        seen.add(offer.sourceUrl); products.push(offer); added++;
        if(products.length >= cap) break;
      }
      start += page.length;
      if(!page.length || (total !== null && start >= total)) {complete=true;break;}
      if(!added) {errors.push({market:"extra-sa",error:"pagination_no_progress"});break;}
      if(total===null && page.length < Number(url.searchParams.get("rows"))) {complete=true;break;}
      if(signal.aborted) throw new Error("pagination_deadline_exceeded");
    } catch(error) {
      if(!products.length) throw error;
      errors.push({market:"extra-sa",error:error.message}); break;
    }
  }
  const {offers,queryFilter}=filterQueryOffers(matchingQuery,products);
  return {provider:"extra-unbxd",ok:offers.length>0,
    searchedMarkets:[{id:"extra-sa",countryCode:"SA",countryNameAr:"السعودية"}],
    offers, errors, diagnostics:{queryFilter,pagination:{fetched:start,total,complete}}};
}
