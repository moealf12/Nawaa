import { moneyToSAR } from "../fx.mjs";
import { normalizeCondition, parseMoney } from "../provider-utils.mjs";

const MARKETS = [
  ["EBAY_US","US","الولايات المتحدة"],
  ["EBAY_GB","GB","بريطانيا"],
  ["EBAY_DE","DE","ألمانيا"],
  ["EBAY_FR","FR","فرنسا"],
  ["EBAY_IT","IT","إيطاليا"],
  ["EBAY_ES","ES","إسبانيا"],
  ["EBAY_AU","AU","أستراليا"],
  ["EBAY_CA","CA","كندا"],
  ["EBAY_NL","NL","هولندا"],
  ["EBAY_PL","PL","بولندا"],
  ["EBAY_AT","AT","النمسا"],
  ["EBAY_CH","CH","سويسرا"],
  ["EBAY_BE","BE","بلجيكا"],
  ["EBAY_IE","IE","أيرلندا"],
  ["EBAY_HK","HK","هونغ كونغ"],
  ["EBAY_SG","SG","سنغافورة"],
];

let tokenCache = { token: null, expiresAt: 0 };

export async function getEbayApplicationToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("eBay credentials are not configured");

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) throw new Error(`eBay OAuth failed: ${response.status}`);
  const data = await response.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000,
  };
  return tokenCache.token;
}

function pickShipping(item) {
  const options = Array.isArray(item.shippingOptions) ? item.shippingOptions : [];
  const priced = options
    .map((o) => ({ value: parseMoney(o?.shippingCost?.value), currency: o?.shippingCost?.currency }))
    .filter((o) => Number.isFinite(o.value));
  if (!priced.length) return null;
  return priced.sort((a,b) => a.value - b.value)[0];
}

async function normalizeItem(item, market) {
  const [marketplaceId, countryCode, countryNameAr] = market;
  const priceValue = parseMoney(item?.price?.value);
  const currency = item?.price?.currency;
  const shipping = pickShipping(item);

  const priceSAR = priceValue !== null && currency ? await moneyToSAR(priceValue, currency).catch(() => null) : null;
  const shippingSAR = shipping?.value !== null && shipping?.currency
    ? await moneyToSAR(shipping.value, shipping.currency).catch(() => null)
    : null;

  return {
    provider: "ebay",
    providerMarket: marketplaceId,
    merchant: "eBay", // Seller account identifiers must not enter client storage or quotes.
    merchantCountryCode: item?.itemLocation?.country || countryCode,
    merchantCountryNameAr: countryNameAr,
    sourceUrl: item?.itemWebUrl || null,
    image: item?.image?.imageUrl || null,
    title: item?.title || "",
    condition: normalizeCondition(item?.condition),
    availability: "in_stock",
    canShipToSaudi: true,
    productPrice: priceSAR?.value ?? null,
    originalProductPrice: priceValue,
    shipping: shippingSAR?.value ?? null,
    originalShipping: shipping?.value ?? null,
    importCost: null,
    tax: null,
    mandatoryFees: 0,
    discount: 0,
    currency: "SAR",
    originalCurrency: currency || null,
    exactMatch: false,
    matchConfidence: 0,
    priceConfidence: "incomplete",
    isLocal: countryCode === "SA",
    deliveryDays: null,
    observedAt: new Date().toISOString(),
    fx: priceSAR ? {
      rate: priceSAR.rate,
      source: priceSAR.source,
      observedAt: priceSAR.observedAt,
    } : null,
  };
}

async function searchMarket(query, market, token, limit = 6) {
  const [marketplaceId] = market;
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    filter: "deliveryCountry:SA,conditions:{NEW}",
  });

  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-ebay-c-marketplace-id": marketplaceId,
      "accept-language": "en-US",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${marketplaceId}: ${response.status} ${body.slice(0,160)}`);
  }

  const data = await response.json();
  const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
  return Promise.all(items.map((item) => normalizeItem(item, market)));
}

export async function searchEbayWorldwide(query, options = {}) {
  const token = await getEbayApplicationToken();
  const requested = Number(options.marketLimit || process.env.EBAY_MARKET_LIMIT || 8);
  const marketLimit = Number.isFinite(requested) ? Math.max(1, Math.min(MARKETS.length, requested)) : 8;
  const selected = MARKETS.slice(0, marketLimit);
  const perMarket = Math.max(1, Math.min(10, Number(options.perMarket || 5)));

  const results = [];
  const errors = [];

  // Keep concurrency conservative for outbound connections and API limits.
  for (let i = 0; i < selected.length; i += 4) {
    const batch = selected.slice(i, i + 4);
    const settled = await Promise.allSettled(batch.map((market) => searchMarket(query, market, token, perMarket)));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") results.push(...result.value);
      else errors.push({ market: batch[index][0], error: result.reason?.message || String(result.reason) });
    });
  }

  return {
    provider: "ebay",
    ok: results.length > 0,
    searchedMarkets: selected.map(([id, code, nameAr]) => ({ id, countryCode: code, countryNameAr: nameAr })),
    offers: results,
    errors,
  };
}

export function ebayConfigured() {
  return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}
