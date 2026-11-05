// NAWAA 1688 staged provider. No network requests or production activation.
// Catalog input must come from an independently authorized 1688 data channel.
import { moneyToSAR } from "../fx.mjs";
import { fetchAuthorized1688Catalog, is1688Configured } from "../authorized-1688-catalog.mjs";

function number(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
}
function integer(value) {
  const n = number(value);
  return Number.isSafeInteger(n) ? n : null;
}
function title(value) {
  return typeof value === "string" && value.trim().length <= 500
    ? value.replace(/[\u0000-\u001f]/g, " ").trim() : null;
}
function image(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password ||
        !/(^|\.)alicdn\.com$|(^|\.)1688\.com$/i.test(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}
function oneUnitPrice(item) {
  const tiers = item.priceTiers ?? item.priceRanges ?? item.priceRange;
  if (Array.isArray(tiers) && tiers.length) {
    const valid = tiers.filter(t => integer(t.minQuantity ?? t.beginAmount ?? t.startQuantity) === 1)
      .map(t => number(t.unitPriceCny ?? t.unitPrice ?? t.price)).filter(Boolean);
    return valid.length === 1 ? { amount: valid[0], evidence: "QUANTITY_ONE_TIER" } : null;
  }
  const amount = number(item.unitPriceCny);
  return item.priceVerifiedForQuantityOne === true && amount
    ? { amount, evidence: "ATTESTED_SINGLE_UNIT_PRICE" } : null;
}

export async function parse1688Catalog(payload, {
  limit = 20, convertMoney = moneyToSAR, observedAt = new Date().toISOString(),
} = {}) {
  const items = Array.isArray(payload?.products) ? payload.products
    : Array.isArray(payload?.items) ? payload.items : null;
  if (!items || items.length > 200) throw new Error("1688_INVALID_CATALOG_SCHEMA");
  const offers = [], rejected = {}, seen = new Set();
  const fail = reason => { rejected[reason] = (rejected[reason] || 0) + 1; };
  const cap = Math.min(40, Math.max(1, Math.floor(Number(limit) || 20)));
  for (const item of items) {
    if (!item || typeof item !== "object") { fail("INVALID_ITEM"); continue; }
    const id = String(item.offerId ?? item.productId ?? "");
    const name = title(item.titleAr) || title(item.titleEn) || title(item.title);
    const moq = integer(item.minimumOrderQuantity ?? item.minOrderQuantity ?? item.moq);
    if (!/^\d{6,20}$/.test(id) || !name) { fail("INVALID_ID_OR_TITLE"); continue; }
    if (item.currency !== "CNY") { fail("UNVERIFIED_CURRENCY"); continue; }
    if (moq === null) { fail("MOQ_UNKNOWN"); continue; }
    if (moq > 1) { fail("WHOLESALE_ONLY"); continue; }
    const tier = oneUnitPrice(item);
    if (!tier) { fail("SINGLE_UNIT_PRICE_UNVERIFIED"); continue; }
    const sku = title(item.skuId ?? item.variantId ?? "") || "";
    const key = id + ":" + sku;
    if (seen.has(key)) { fail("DUPLICATE"); continue; }
    const fx = await convertMoney(tier.amount, "CNY").catch(() => null);
    if (!fx || !(fx.value > 0) || !(fx.rate > 0) || !fx.source || !fx.observedAt) {
      fail("FX_UNAVAILABLE"); continue;
    }
    seen.add(key);
    const stock = Number.isSafeInteger(item.stockQuantity) && item.stockQuantity >= 0
      ? item.stockQuantity : null;
    offers.push({
      provider: "1688-cn", providerMarket: "1688-cn",
      merchant: "1688", merchantCountryCode: "CN", merchantCountryNameAr: "الصين",
      sourceUrl: "https://detail.1688.com/offer/" + id + ".html",
      image: image(item.imageUrl ?? item.image), title: name,
      condition: item.condition === "new" ? "new" : "unknown",
      availability: stock === null ? "unknown" : stock > 0 ? "in_stock" : "out_of_stock",
      canShipToSaudi: null, isLocal: false, exactMatch: false, matchConfidence: 0,
      priceConfidence: "incomplete", productPrice: fx.value, originalProductPrice: tier.amount,
      originalCurrency: "CNY", currency: "SAR",
      shipping: null, importCost: null, tax: null, mandatoryFees: 0, discount: 0,
      deliveryDays: null, observedAt, dataKind: "live",
      fx: { rate: fx.rate, source: fx.source, observedAt: fx.observedAt },
      specs: { modelNumber: title(item.modelNumber), brand: title(item.brand), sku },
      sourceMeta: {
        productId: id, skuId: sku || null, minimumOrderQuantity: 1,
        priceEvidence: tier.evidence, quotedQuantity: 1,
        sourceDataChannel: "AUTHORIZED_CATALOG",
        shippingStatus: "FORWARDER_OR_UNVERIFIED",
        requiresSaudiDeliveryVerification: true, originalTitle: title(item.title),
      },
    });
    if (offers.length >= cap) break;
  }
  return { offers, diagnostics: {
    received: items.length, accepted: offers.length, rejected, saudiShippingVerified: 0,
  }};
}

// Explicitly injected authorized catalog client. No fallback to page scraping.
export async function search1688(query, {catalogSearch, signal, ...options} = {}) {
  if (typeof catalogSearch !== "function" && !is1688Configured(options.env || process.env)) return {
    provider: "1688-cn", ok: false, offers: [],
    errors: [{ error: "1688_AUTHORIZED_CATALOG_NOT_CONFIGURED" }],
  };
  if (typeof query !== "string" || !query.trim() || query.length > 160) return {
    provider: "1688-cn", ok: false, offers: [], errors: [{ error: "1688_INVALID_QUERY" }],
  };
  signal?.throwIfAborted();
  try {
    const payload = await (catalogSearch || ((q, args) => fetchAuthorized1688Catalog(q, {...args, ...options})))(query.trim(), {signal, limit: options.limit ?? 20});
    signal?.throwIfAborted();
    const parsed = await parse1688Catalog(payload, options);
    return { provider: "1688-cn", ok: parsed.offers.length > 0,
      offers: parsed.offers, errors: [], diagnostics: parsed.diagnostics };
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    return { provider: "1688-cn", ok: false, offers: [],
      errors: [{ error: String(error?.message || "1688_CATALOG_ERROR").slice(0, 180) }] };
  }
}
