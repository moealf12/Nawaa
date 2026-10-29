/**
 * Read-only, offline normalization for noon's official GetProductOffers response.
 *
 * Official endpoint: GET /offer/v1/product/{partner_sku}
 * Documentation: https://noon-docs.noonpartners.dev/docs/api-reference/offer/offer-service-get-product-offers
 *
 * IMPORTANT: This is a seller-/partner-scoped API, not public noon.com search.
 * A successful partner offer is NOT independent evidence of the retail PDP,
 * shipping to a given guest, or permission to republish Noon-wide prices.
 *
 * This module intentionally makes NO network calls and owns NO credentials.
 * Nothing in it is wired to the customer search, index, ingestion, or output.
 */

const PARTNER_SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NOON_SKU = /^(?:N\d{8}[AV]|Z[A-Z0-9]{20}Z)$/i;
const OFFER_CODE = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_OFFERS = 100;

function validMoney(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10_000_000)
    return null;
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-6 ? cents : null;
}

function empty(status) {
  return {
    source:"noon-partners-offer",
    status,
    accessScope:"AUTHORIZED_PARTNER_SKU_ONLY",
    marketplace:"SA",
    customerPublishable:false,
    pdpVerified:false,
    independentPriceVerified:false,
    eligible:[],
    rejected:0,
    conflicting:0,
  };
}

/**
 * Treat only a separately authorized seller's explicitly requested partner SKU
 * as evidence. Return candidates for internal evaluation, never search offers.
 */
export function inspectNoonPartnerOffers(payload, {partnerSku, expectedNoonSku=null}={}) {
  if (typeof partnerSku !== "string" || !PARTNER_SKU.test(partnerSku))
    return empty("INVALID_PARTNER_SKU");
  if (expectedNoonSku != null &&
      (typeof expectedNoonSku !== "string" || !NOON_SKU.test(expectedNoonSku)))
    return empty("INVALID_EXPECTED_NOON_SKU");
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return empty("INVALID_RESPONSE");
  if (payload.partner_sku !== partnerSku)
    return empty("PARTNER_SKU_MISMATCH");
  if (typeof payload.sku !== "string" || !NOON_SKU.test(payload.sku))
    return empty("NOON_SKU_INVALID");
  const noonSku = payload.sku.toUpperCase();
  if (expectedNoonSku && noonSku !== expectedNoonSku.toUpperCase())
    return empty("NOON_SKU_MISMATCH");
  if (typeof payload.title !== "string" || !payload.title.trim() ||
      payload.title.length > 500 || !Array.isArray(payload.offers) ||
      payload.offers.length > MAX_OFFERS)
    return empty("RESPONSE_SCHEMA_INVALID");

  const grouped = new Map();
  let rejected = 0;
  for (const offer of payload.offers) {
    if (!offer || typeof offer !== "object" || Array.isArray(offer) ||
        offer.country_code !== "sa" || offer.live_status !== true ||
        offer.is_active !== true || !Number.isSafeInteger(offer.active_net_stock) ||
        offer.active_net_stock <= 0 ||
        typeof offer.offer_code !== "string" || !OFFER_CODE.test(offer.offer_code) ||
        offer.price?.currency !== "SAR") {
      rejected++;
      continue;
    }
    const priceCents = validMoney(offer.price?.amount);
    if (priceCents == null) {rejected++;continue;}
    const model = offer.business_model;
    if (typeof model !== "string" || !/^[a-z][a-z0-9_-]{0,48}$/.test(model)) {
      rejected++;
      continue;
    }
    const key = offer.offer_code+"|"+model;
    if (!grouped.has(key)) grouped.set(key,[]);
    grouped.get(key).push({offerCode:offer.offer_code, businessModel:model,
      currency:"SAR", priceCents, activeNetStock:offer.active_net_stock});
  }
  const eligible = [];
  let conflicting = 0;
  for (const records of grouped.values()) {
    const prices = new Set(records.map(x=>x.priceCents));
    if (prices.size !== 1) {conflicting++;continue;}
    // Do not infer shipping, seller attribution or PDP identity from API alone.
    const record = records[0];
    eligible.push({
      partnerSku, noonSku, title:payload.title.trim(),
      ...record, customerPublishable:false,
      sourceScope:"AUTHORIZED_SELLER_PROJECT",
      sourceProductUrl:null, sellerVerified:false,
      pdpVerified:false, independentPriceVerified:false,
    });
  }
  return {
    source:"noon-partners-offer",
    status:conflicting ? "PARTNER_OFFER_PRICE_CONFLICT"
      : eligible.length ? "SELLER_SCOPED_OFFER_OBSERVED" : "NO_ELIGIBLE_SAUDI_OFFERS",
    accessScope:"AUTHORIZED_PARTNER_SKU_ONLY",
    marketplace:"SA",
    customerPublishable:false, pdpVerified:false,
    independentPriceVerified:false,
    eligible, rejected, conflicting,
  };
}
