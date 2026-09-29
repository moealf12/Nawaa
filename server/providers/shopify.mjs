import { moneyToSAR } from "../fx.mjs";
import { parseMoney } from "../provider-utils.mjs";

function parseStores() {
  const raw = process.env.SHOPIFY_STORES_JSON || "[]";
  let parsed = [];
  try { parsed = JSON.parse(raw); } catch { parsed = []; }
  return Array.isArray(parsed) ? parsed.filter((s) => s?.baseUrl && s?.name && s?.countryCode) : [];
}

function cleanBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

async function searchStore(query, store, limit = 6) {
  const baseUrl = cleanBaseUrl(store.baseUrl);
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("resources[type]", "product");
  params.set("resources[limit]", String(Math.max(1, Math.min(10, limit))));
  params.set("resources[options][unavailable_products]", "hide");
  params.set("resources[options][fields]", "title,product_type,variants.title,vendor");

  const url = `${baseUrl}/search/suggest.json?${params}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "NAWAA-Price-Discovery/0.2 (+https://moealf12.github.io/Nawaa/)",
    },
    redirect: "follow",
  });

  if (!response.ok) throw new Error(`${store.name}: ${response.status}`);
  const data = await response.json();
  const products = data?.resources?.results?.products || [];

  return Promise.all(products.map(async (product) => {
    const currency = store.currency || product?.price?.currency || product?.currency || null;
    const rawPrice =
      parseMoney(product?.price) ??
      parseMoney(product?.price_min) ??
      parseMoney(product?.variants?.[0]?.price);

    const priceSAR = rawPrice !== null && currency
      ? await moneyToSAR(rawPrice, currency).catch(() => null)
      : null;

    return {
      provider: "shopify",
      providerMarket: store.id || store.name,
      merchant: store.name,
      merchantCountryCode: String(store.countryCode).toUpperCase(),
      merchantCountryNameAr: store.countryNameAr || store.countryCode,
      sourceUrl: product?.url ? new URL(product.url, baseUrl).href : baseUrl,
      image: product?.featured_image?.url || product?.image || null,
      title: product?.title || "",
      condition: "new",
      availability: "in_stock",
      canShipToSaudi: store.saudiDelivery === "native" ? true : null,
      productPrice: priceSAR?.value ?? null,
      originalProductPrice: rawPrice,
      shipping: null,
      importCost: null,
      tax: null,
      mandatoryFees: 0,
      discount: 0,
      currency: "SAR",
      originalCurrency: currency,
      exactMatch: false,
      matchConfidence: 0,
      priceConfidence: "incomplete",
      isLocal: String(store.countryCode).toUpperCase() === "SA",
      deliveryDays: null,
      observedAt: new Date().toISOString(),
      fx: priceSAR ? {
        rate: priceSAR.rate,
        source: priceSAR.source,
        observedAt: priceSAR.observedAt,
      } : null,
    };
  }));
}

export async function searchConfiguredShopifyStores(query, options = {}) {
  const stores = parseStores();
  if (!stores.length) {
    return { provider: "shopify", ok: false, offers: [], errors: [], searchedStores: [] };
  }

  const perStore = Math.max(1, Math.min(10, Number(options.perStore || 5)));
  const offers = [];
  const errors = [];

  for (let i = 0; i < stores.length; i += 5) {
    const batch = stores.slice(i, i + 5);
    const settled = await Promise.allSettled(batch.map((store) => searchStore(query, store, perStore)));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") offers.push(...result.value);
      else errors.push({ store: batch[index].name, error: result.reason?.message || String(result.reason) });
    });
  }

  return {
    provider: "shopify",
    ok: offers.length > 0,
    offers,
    errors,
    searchedStores: stores.map((s) => ({
      id: s.id || s.name,
      name: s.name,
      countryCode: s.countryCode,
      countryNameAr: s.countryNameAr || s.countryCode,
    })),
  };
}

export function shopifyConfigured() {
  return parseStores().length > 0;
}
