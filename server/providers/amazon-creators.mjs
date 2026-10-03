import { moneyToSAR } from "../fx.mjs";
import { normalizeCondition } from "../provider-utils.mjs";

const API_BASE = "https://creatorsapi.amazon/catalog/v1/searchItems";

const MARKET_DEFS = [
  { id:"amazon-sa", marketplace:"www.amazon.sa", tagEnv:"AMAZON_PARTNER_TAG_SA", countryCode:"SA", countryNameAr:"السعودية" },
  { id:"amazon-ae", marketplace:"www.amazon.ae", tagEnv:"AMAZON_PARTNER_TAG_AE", countryCode:"AE", countryNameAr:"الإمارات" },
  { id:"amazon-us", marketplace:"www.amazon.com", tagEnv:"AMAZON_PARTNER_TAG_US", countryCode:"US", countryNameAr:"الولايات المتحدة" },
  { id:"amazon-ca", marketplace:"www.amazon.ca", tagEnv:"AMAZON_PARTNER_TAG_CA", countryCode:"CA", countryNameAr:"كندا" },
  { id:"amazon-uk", marketplace:"www.amazon.co.uk", tagEnv:"AMAZON_PARTNER_TAG_UK", countryCode:"GB", countryNameAr:"بريطانيا" },
  { id:"amazon-de", marketplace:"www.amazon.de", tagEnv:"AMAZON_PARTNER_TAG_DE", countryCode:"DE", countryNameAr:"ألمانيا" },
  { id:"amazon-fr", marketplace:"www.amazon.fr", tagEnv:"AMAZON_PARTNER_TAG_FR", countryCode:"FR", countryNameAr:"فرنسا" },
  { id:"amazon-it", marketplace:"www.amazon.it", tagEnv:"AMAZON_PARTNER_TAG_IT", countryCode:"IT", countryNameAr:"إيطاليا" },
  { id:"amazon-es", marketplace:"www.amazon.es", tagEnv:"AMAZON_PARTNER_TAG_ES", countryCode:"ES", countryNameAr:"إسبانيا" },
  { id:"amazon-jp", marketplace:"www.amazon.co.jp", tagEnv:"AMAZON_PARTNER_TAG_JP", countryCode:"JP", countryNameAr:"اليابان" },
  { id:"amazon-in", marketplace:"www.amazon.in", tagEnv:"AMAZON_PARTNER_TAG_IN", countryCode:"IN", countryNameAr:"الهند" },
  { id:"amazon-sg", marketplace:"www.amazon.sg", tagEnv:"AMAZON_PARTNER_TAG_SG", countryCode:"SG", countryNameAr:"سنغافورة" },
  { id:"amazon-au", marketplace:"www.amazon.com.au", tagEnv:"AMAZON_PARTNER_TAG_AU", countryCode:"AU", countryNameAr:"أستراليا" },
  { id:"amazon-eg", marketplace:"www.amazon.eg", tagEnv:"AMAZON_PARTNER_TAG_EG", countryCode:"EG", countryNameAr:"مصر" },
];

let tokenCache = { identity:"", token:"", expiresAt:0 };

function credentialVersion() {
  return String(process.env.AMAZON_CREATORS_VERSION || "").trim();
}

function tokenEndpoint(version) {
  if (version.startsWith("3.1")) return "https://api.amazon.com/auth/o2/token";
  if (version.startsWith("3.2")) return "https://api.amazon.co.uk/auth/o2/token";
  if (version.startsWith("3.3")) return "https://api.amazon.co.jp/auth/o2/token";
  return null;
}

export function configuredAmazonCreatorMarkets() {
  return MARKET_DEFS
    .map((market) => ({ ...market, partnerTag:String(process.env[market.tagEnv] || "").trim() }))
    .filter((market) => market.partnerTag);
}

export function amazonCreatorsConfigured() {
  return Boolean(
    String(process.env.AMAZON_CREATORS_CLIENT_ID || "").trim() &&
    String(process.env.AMAZON_CREATORS_CLIENT_SECRET || "").trim() &&
    tokenEndpoint(credentialVersion()) &&
    configuredAmazonCreatorMarkets().length
  );
}

async function accessToken() {
  const clientId = String(process.env.AMAZON_CREATORS_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.AMAZON_CREATORS_CLIENT_SECRET || "").trim();
  const version = credentialVersion();
  const endpoint = tokenEndpoint(version);
  if (!clientId || !clientSecret || !endpoint) throw new Error("Amazon Creators API credentials are incomplete");

  const identity = `${clientId}:${version}`;
  if (tokenCache.identity === identity && tokenCache.token && tokenCache.expiresAt - Date.now() > 60000) {
    return tokenCache.token;
  }

  const response = await fetch(endpoint, {
    method:"POST",
    headers:{"content-type":"application/json","accept":"application/json"},
    body:JSON.stringify({
      grant_type:"client_credentials",
      client_id:clientId,
      client_secret:clientSecret,
      scope:"creatorsapi::default",
    }),
    signal:AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`amazon-creators-token: HTTP ${response.status}`);
  }
  const expiresIn = Number(payload.expires_in) || 3600;
  tokenCache = { identity, token:payload.access_token, expiresAt:Date.now() + expiresIn * 1000 };
  return tokenCache.token;
}

function displayValue(node) {
  if (node === null || node === undefined) return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") return node.displayValue ?? node.display_value ?? node.value ?? null;
  return null;
}

function firstExternalId(itemInfo = {}) {
  const external = itemInfo.externalIds || itemInfo.externalIDs || {};
  const buckets = Object.values(external);
  for (const bucket of buckets) {
    const values = bucket?.displayValues || bucket?.display_values || bucket?.values;
    if (Array.isArray(values) && values.length) return String(values[0]);
  }
  return null;
}

export async function normalizeAmazonCreatorsItem(item, market) {
  const itemInfo = item?.itemInfo || {};
  const listings = Array.isArray(item?.offersV2?.listings) ? item.offersV2.listings : [];
  const listing = listings.find((entry) => entry?.isBuyBoxWinner) || listings[0] || null;
  const money = listing?.price?.money || null;
  const originalProductPrice = Number(money?.amount);
  const originalCurrency = String(money?.currency || "").toUpperCase() || null;
  if (!item?.asin || !item?.detailPageURL || !Number.isFinite(originalProductPrice) || originalProductPrice <= 0 || !originalCurrency) return null;

  const converted = originalCurrency === "SAR"
    ? { value:originalProductPrice, rate:1, source:"identity", observedAt:new Date().toISOString() }
    : await moneyToSAR(originalProductPrice, originalCurrency).catch(() => null);
  if (!converted) return null;

  const condition = normalizeCondition(displayValue(listing?.condition) || listing?.condition?.value || "new");
  const availabilityType = String(listing?.availability?.type || "").toUpperCase();
  const brand = displayValue(itemInfo?.byLineInfo?.brand) || displayValue(itemInfo?.manufactureInfo?.itemPartNumber) || null;
  const title = displayValue(itemInfo?.title) || `Amazon ${item.asin}`;
  const sellerName = listing?.merchantInfo?.name || `Amazon ${market.countryCode}`;

  return {
    provider:"amazon-creators",
    providerMarket:market.id,
    merchant:sellerName,
    merchantCountryCode:market.countryCode,
    merchantCountryNameAr:market.countryNameAr,
    sourceUrl:item.detailPageURL,
    image:item?.images?.primary?.medium?.url || item?.images?.primary?.large?.url || item?.images?.primary?.small?.url || null,
    title,
    brand,
    condition:condition === "unknown" ? "new" : condition,
    availability:availabilityType.includes("IN_STOCK") ? "in_stock" : availabilityType.includes("OUT_OF_STOCK") ? "out_of_stock" : "unknown",
    canShipToSaudi:market.countryCode === "SA" ? true : null,
    directShippingToSaudi:market.countryCode === "SA" ? true : null,
    productPrice:converted.value,
    originalProductPrice,
    shipping:null,
    originalShipping:null,
    importCost:market.countryCode === "SA" ? 0 : null,
    tax:null,
    mandatoryFees:0,
    discount:0,
    currency:"SAR",
    originalCurrency,
    exactMatch:false,
    matchConfidence:0,
    priceConfidence:"incomplete",
    isLocal:market.countryCode === "SA",
    deliveryDays:null,
    observedAt:new Date().toISOString(),
    fx:{ rate:converted.rate, source:converted.source, observedAt:converted.observedAt },
    seller:{ name:sellerName, type:"marketplace_seller" },
    specs:{
      brand,
      series:null,
      deviceType:null,
      color:displayValue(itemInfo?.productInfo?.color) || null,
      storage:null,
      modelNumber:item.asin,
      barcode:firstExternalId(itemInfo),
    },
    sourceMeta:{ asin:item.asin, marketplace:market.marketplace, officialApi:true, parsedFrom:"amazon-creators-search" },
  };
}

export async function parseAmazonCreatorsPayload(payload, market, limit = 10) {
  const items = Array.isArray(payload?.searchResult?.items) ? payload.searchResult.items.slice(0, limit) : [];
  return (await Promise.all(items.map((item) => normalizeAmazonCreatorsItem(item, market)))).filter(Boolean);
}

async function searchMarket(query, market, token, limit) {
  const response = await fetch(API_BASE, {
    method:"POST",
    headers:{
      authorization:`Bearer ${token}`,
      "content-type":"application/json",
      accept:"application/json",
      "x-marketplace":market.marketplace,
    },
    body:JSON.stringify({
      keywords:query,
      partnerTag:market.partnerTag,
      marketplace:market.marketplace,
      searchIndex:"All",
      itemCount:Math.max(1, Math.min(10, limit)),
      resources:[
        "images.primary.medium",
        "itemInfo.title",
        "itemInfo.byLineInfo",
        "itemInfo.externalIds",
        "itemInfo.productInfo",
        "offersV2.listings.availability",
        "offersV2.listings.condition",
        "offersV2.listings.merchantInfo",
        "offersV2.listings.price"
      ],
    }),
    signal:AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`amazon-creators ${market.id}: HTTP ${response.status}`);
  return parseAmazonCreatorsPayload(payload, market, limit);
}

export async function searchAmazonCreators(query, options = {}) {
  const markets = configuredAmazonCreatorMarkets().filter(market=>!options.marketId || market.id === options.marketId);
  if (!amazonCreatorsConfigured() || !markets.length) {
    return { provider:"amazon-creators", ok:false, searchedMarkets:[], offers:[], errors:[] };
  }

  const token = await accessToken();
  const perMarket = Math.max(1, Math.min(10, Number(options.perMarket || 10)));
  const settled = await Promise.allSettled(markets.map((market) => searchMarket(query, market, token, perMarket)));
  const offers = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") offers.push(...result.value);
    else errors.push({ market:markets[index].id, error:result.reason?.message || String(result.reason) });
  });

  return {
    provider:"amazon-creators",
    ok:offers.length > 0,
    searchedMarkets:markets.map(({id,countryCode,countryNameAr,marketplace}) => ({id,countryCode,countryNameAr,marketplace})),
    offers,
    errors,
  };
}
