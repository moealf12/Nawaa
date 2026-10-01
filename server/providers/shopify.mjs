import { moneyToSAR } from "../fx.mjs";
import { normalizeSearchQuery } from "../../src/search-query.mjs";

function relevantProduct(query, product) {
  const normalized = normalizeSearchQuery(query);
  if (normalized === normalizeSearchQuery(product.vendor || "")) return true;
  const words = normalizeSearchQuery([product.title, product.type, ...(product.variants || []).map(v => v.title)].filter(Boolean).join(" ")).split(" ");
  return normalized.split(" ").some(token => token && words.some(word => word === token || word === `${token}s` || `${word}s` === token));
}

export function configuredShopifyStores() {
  const raw = process.env.SHOPIFY_STORES_JSON || "[]";
  let parsed = [];
  try { parsed = JSON.parse(raw); } catch { parsed = []; }
  return Array.isArray(parsed) ? parsed.filter((s) => s?.baseUrl && s?.name && s?.countryCode) : [];
}

function cleanBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

// Ajax product prices are in minor units; predictive prices can be ranges.
// Confirm each available variant before emitting a priced offer.
export async function searchShopifyStore(query, store, {limit = 5, fetchImpl = fetch, convertMoney = moneyToSAR} = {}) {
  const baseUrl = cleanBaseUrl(store.baseUrl);
  const signal = AbortSignal.timeout(15000);
  const get = async url => {
    const response = await fetchImpl(url, {
      headers: {accept:"application/json", "user-agent":"NAWAA-Price-Discovery/0.5"},
      redirect:"follow", signal,
    });
    if(!response.ok) throw new Error(`${store.name}: HTTP ${response.status}`);
    return response.json();
  };
  const params = new URLSearchParams({q:query,"resources[type]":"product","resources[limit]":String(Math.max(1,Math.min(10,limit))),"resources[options][unavailable_products]":"hide","resources[options][fields]":"title,product_type,variants.title,vendor"});
  const [cart, data] = await Promise.all([get(`${baseUrl}/cart.js`),get(`${baseUrl}/search/suggest.json?${params}`)]);
  const currency = cart?.currency;
  if(!/^[A-Z]{3}$/.test(currency || "") || (store.currency && currency !== store.currency)) throw new Error(`${store.name}: currency changed or is unavailable`);
  // Supported currencies use two decimal places. Reject unverified
  // currency precision instead of interpreting integer prices incorrectly.
  if(!["USD","SAR","EUR","GBP","CAD","AUD","HKD","AED"].includes(currency)) throw new Error(`${store.name}: unsupported currency precision`);
  const products = (data?.resources?.results?.products || []).slice(0,Math.max(1,Math.min(10,limit)));
  const settled = await Promise.allSettled(products.map(async suggestion => {
    const handle = suggestion.handle;
    if(typeof handle !== "string" || !/^[a-zA-Z0-9_-]{1,250}$/.test(handle)) throw new Error("Invalid product handle");
    const product = await get(`${baseUrl}/products/${encodeURIComponent(handle)}.js`);
    if (!relevantProduct(query, product)) return [];
    const variants = (product.variants || []).filter(v => v.available === true && Number.isSafeInteger(v.price) && v.price >= 0 && v.id != null).slice(0,3);
    return Promise.all(variants.map(async variant => {
      const rawPrice = variant.price / 100;
      const priceSAR = await convertMoney(rawPrice,currency).catch(()=>null);
      const sourceUrl = new URL(`${baseUrl}/products/${encodeURIComponent(handle)}`);
      sourceUrl.searchParams.set("variant", String(variant.id));
      const image = variant.featured_image?.src || variant.featured_image?.url || product.featured_image || suggestion.featured_image?.url || suggestion.image || null;
      const optionTitle = variant.title && variant.title !== "Default Title" ? ` · ${variant.title}` : "";
      return {
        provider:"shopify", providerMarket:store.id || store.name, merchant:store.name,
        merchantCountryCode:String(store.countryCode).toUpperCase(), merchantCountryNameAr:store.countryNameAr || store.countryCode,
        sourceUrl:sourceUrl.href, image:image ? new URL(image,baseUrl).href : null,
        title:`${product.title || suggestion.title || ""}${optionTitle}`, brand:product.vendor || suggestion.vendor || null,
        productType:product.type || suggestion.type || null, sku:variant.sku || null,
        specs:Object.fromEntries((product.options || []).map((option,i)=>[typeof option === "string" ? option : option.name, variant.options?.[i]]).filter(([key,value])=>key && value)),
        condition:"new", availability:"in_stock",
        canShipToSaudi:store.saudiDelivery === "native" ? true : null,
        directShippingToSaudi:store.saudiDelivery === "forwarding_required" ? false : null,
        shippingMode:store.saudiDelivery || "unknown",
        productPrice:priceSAR?.value ?? null, originalProductPrice:rawPrice,
        shipping:null, originalShipping:null, importCost:null, tax:null, mandatoryFees:0, discount:0,
        currency:"SAR", originalCurrency:currency, exactMatch:false, matchConfidence:0, priceConfidence:"incomplete",
        isLocal:String(store.countryCode).toUpperCase() === "SA", deliveryDays:null,
        observedAt:new Date().toISOString(), fx:priceSAR ? {rate:priceSAR.rate,source:priceSAR.source,observedAt:priceSAR.observedAt} : null,
      };
    }));
  }));
  const offers=[], errors=[];
  settled.forEach((result,index)=>{
    if(result.status === "fulfilled") offers.push(...result.value);
    else errors.push({store:store.name,product:products[index].handle,error:result.reason?.message || "Product lookup failed"});
  });
  return {offers,errors};
}

export async function searchConfiguredShopifyStores(query, options = {}) {
  const stores = configuredShopifyStores();
  if (!stores.length) {
    return { provider: "shopify", ok: false, offers: [], errors: [], searchedStores: [] };
  }

  const perStore = Math.max(1, Math.min(10, Number(options.perStore || 5)));
  const offers = [];
  const errors = [];

  for (let i = 0; i < stores.length; i += 5) {
    const batch = stores.slice(i, i + 5);
    const settled = await Promise.allSettled(batch.map((store) => searchShopifyStore(query, store, {limit:perStore})));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") { offers.push(...result.value.offers); errors.push(...result.value.errors); }
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
  return configuredShopifyStores().length > 0;
}
