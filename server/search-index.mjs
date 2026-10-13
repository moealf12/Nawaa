let client, MeiliCtor;

// Optional index recall only: an indexed document is not a new live price
// observation, and a successful index write must not refresh observation time.
export const INDEXED_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
export const searchIndexConfigured = () => Boolean(process.env.MEILI_HOST && process.env.MEILI_MASTER_KEY);

async function index() {
  if (!searchIndexConfigured()) return null;
  if (!MeiliCtor) MeiliCtor = (await import("meilisearch")).MeiliSearch;
  client ||= new MeiliCtor({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
  return client.index(process.env.MEILI_INDEX || "offers");
}

function observedAtEvidence(value, now) {
  if (typeof value !== "string" || !value.trim()) return null;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp) || stamp > now + CLOCK_SKEW_MS ||
      now - stamp >= INDEXED_PRICE_MAX_AGE_MS) return null;
  return new Date(stamp).toISOString();
}

function validSourceUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) &&
      !url.username && !url.password;
  } catch { return false; }
}

function isValidPriceEvidence(offer, now) {
  if (!offer || typeof offer.title !== "string" || !offer.title.trim() ||
      !validSourceUrl(offer.sourceUrl) ||
      typeof offer.productPrice !== "number" ||
      !Number.isFinite(offer.productPrice) || offer.productPrice <= 0 ||
      typeof offer.currency !== "string" ||
      !/^[A-Z]{3}$/.test(offer.currency) ||
      !observedAtEvidence(offer.observedAt, now)) return false;

  // A claimed foreign-to-SAR conversion must retain its original price
  // and FX evidence; otherwise the converted amount is unverifiable.
  if (offer.originalCurrency && offer.originalCurrency !== offer.currency) {
    if (!/^[A-Z]{3}$/.test(offer.originalCurrency) ||
        typeof offer.originalProductPrice !== "number" ||
        !Number.isFinite(offer.originalProductPrice) ||
        offer.originalProductPrice <= 0 ||
        typeof offer.fx?.rate !== "number" ||
        !Number.isFinite(offer.fx.rate) || offer.fx.rate <= 0 ||
        typeof offer.fx.source !== "string" || !offer.fx.source.trim() ||
        typeof offer.fx.observedAt !== "string" ||
        !Number.isFinite(Date.parse(offer.fx.observedAt)) ||
        Date.parse(offer.fx.observedAt) > now + CLOCK_SKEW_MS)
      return false;
  }
  return true;
}

// Export pure helpers for deterministic, zero-network regression tests.
export function buildIndexedDocuments(offers = [], {now = Date.now()} = {}) {
  return offers.filter(offer => isValidPriceEvidence(offer, now)).map(offer => ({
    id:Buffer.from([offer.sourceUrl,offer.condition || "new"].join("|"))
      .toString("base64url").slice(0, 500),
    title:offer.title,
    brand:offer.brand || offer.specs?.brand || null,
    merchant:offer.merchant || null,
    merchantCountryCode:offer.merchantCountryCode || null,
    productPrice:offer.productPrice,
    totalSAR:offer.totalSAR ?? null,
    currency:offer.currency,
    originalCurrency:offer.originalCurrency || null,
    originalProductPrice:offer.originalProductPrice ?? null,
    fx:offer.fx || null,
    sourceUrl:offer.sourceUrl,
    imageUrl:offer.imageUrl || offer.image || null,
    sku:offer.sku || null,
    condition:offer.condition || null,
    availability:offer.availability || null,
    matchConfidence:offer.matchConfidence ?? null,
    exactMatch:offer.exactMatch === true,
    observedAt:observedAtEvidence(offer.observedAt, now),
  }));
}

export function restoreIndexedOffer(hit, {now = Date.now()} = {}) {
  if (!isValidPriceEvidence(hit, now)) return null;
  return {
    ...hit,
    observedAt:observedAtEvidence(hit.observedAt, now),
    image:hit.image || hit.imageUrl || null,
    // Stock, shipping and landed costs cannot be asserted current merely
    // because a catalog index found the record.
    availability:"unknown",
    totalSAR:null,
    priceConfidence:"incomplete",
    dataKind:"indexed",
  };
}

export async function indexOffers(offers = [], {target = null, now = Date.now()} = {}) {
  const destination = target || await index();
  if (!destination || !offers.length) return {configured:Boolean(destination),indexed:0};
  const docs = buildIndexedDocuments(offers,{now});
  if (docs.length) await destination.addDocuments(docs);
  return {configured:true,indexed:docs.length};
}

export async function searchIndexedOffers(query, {limit = 80, target = null, now = Date.now()} = {}) {
  const source = target || await index();
  if (!source || !String(query || "").trim()) return {configured:Boolean(source),offers:[]};
  const result = await source.search(String(query),{
    limit,
    attributesToRetrieve:[
      "title","brand","merchant","merchantCountryCode","productPrice",
      "totalSAR","currency","originalCurrency","originalProductPrice","fx",
      "sourceUrl","imageUrl","sku","condition","availability","matchConfidence",
      "exactMatch","observedAt",
    ],
  });
  return {
    configured:true,
    offers:(result.hits || []).map(hit => restoreIndexedOffer(hit,{now})).filter(Boolean),
  };
}
