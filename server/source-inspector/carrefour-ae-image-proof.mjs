// Read-only Carrefour UAE image qualification. Not imported by customer search.
const MAX_PROBES = 8;
const MAX_CONCURRENCY = 2;
const HOST = "www.carrefouruae.com";
const MODEL_FLAGS = new Set(["pro", "max", "plus", "ultra", "mini", "air", "lite", "neo"]);

function productLocation(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== HOST ||
        url.username || url.password) return null;
    const id = url.pathname.match(/^\/mafuae\/en\/(?:.+\/)?p\/(\d+)(?:\/)?$/i)?.[1];
    return id ? { id, url: url.href } : null;
  } catch { return null; }
}

function tokens(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/(\d+)\s*(gb|tb)\b/g, "$1$2")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .split(/\s+/).filter(Boolean)
    .filter(token => !new Set(["buy", "online", "from", "with", "and", "the", "carrefour", "uae"]).has(token));
}

function consistentTitle(a, b) {
  const aTokens = new Set(tokens(a)), bTokens = new Set(tokens(b));
  if (aTokens.size < 3 || bTokens.size < 3) return false;
  const matched = [...aTokens].filter(token => bTokens.has(token)).length;
  if (matched < 3 || matched / aTokens.size < 0.75 ||
      matched / bTokens.size < 0.5) return false;
  for (const flag of MODEL_FLAGS) {
    if (aTokens.has(flag) !== bTokens.has(flag)) return false;
  }
  // Search cards define the requested variant. Do not accept a PDP for another capacity.
  for (const token of aTokens) {
    if (/^\d+(?:gb|tb)$/.test(token) && !bTokens.has(token)) return false;
  }
  return true;
}

function offerPrice(product) {
  const raw = product?.offers;
  const offers = Array.isArray(raw) ? raw : raw?.offers && Array.isArray(raw.offers) ? raw.offers : raw ? [raw] : [];
  return offers.map(entry => {
    const amount = entry?.price ?? entry?.lowPrice;
    const price = typeof amount === "number" ? amount :
      /^\d+(?:\.\d+)?$/.test(String(amount || "").replace(/,/g, "")) ?
        Number(String(amount).replace(/,/g, "")) : null;
    return { price, currency: String(entry?.priceCurrency || "").toUpperCase() };
  }).filter(value => Number.isFinite(value.price) && value.price > 0);
}

function candidateImage(product, finalUrl) {
  const raw = Array.isArray(product?.image) ? product.image[0] : product?.image;
  const ref = typeof raw === "string" ? raw : raw?.url || raw?.src;
  if (typeof ref !== "string" || !ref.trim()) return null;
  try {
    const url = new URL(ref, finalUrl);
    if (url.protocol !== "https:" || url.username || url.password ||
        !url.hostname || url.hostname.length > 253 ||
        !/^[a-z0-9.-]+$/i.test(url.hostname) ||
        /(?:^|\.)localhost$|(?:^|\.)local$|(?:^|\.)internal$/.test(url.hostname) ||
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) ||
        /\/(?:pixel|tracker|placeholder|no-image|sprite)(?:[\/._-]|$)/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

function explicitIdentityMismatch(product, expectedId) {
  const refs = [product?.url, product?.["@id"], product?.offers?.url];
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    const match = ref.match(/\/p\/(\d+)(?:[/?#]|$)/i);
    if (match && match[1] !== expectedId) return true;
  }
  const sku = String(product?.sku ?? product?.productID ?? "").trim();
  // Only Carrefour-style numeric page IDs are comparable to /p/<id>.
  return /^\d{6,9}$/.test(sku) && sku !== expectedId;
}

export function verifyCarrefourAeImageFromPage(offer, page) {
  const requested = productLocation(offer?.sourceUrl);
  if (!requested) return { accepted:false, reason:"invalid_product_url" };
  if (String(offer?.originalCurrency || "").toUpperCase() !== "AED" ||
      !Number.isFinite(Number(offer?.originalProductPrice)) ||
      Number(offer.originalProductPrice) <= 0)
    return { accepted:false, reason:"invalid_original_price" };
  const landing = productLocation(page?.finalUrl);
  if (!landing || landing.id !== requested.id)
    return { accepted:false, reason:"product_redirect_mismatch" };
  let reason = "no_matching_page_candidate";
  for (const candidate of page?.candidates || []) {
    const product = candidate?.product;
    if (!product || typeof product !== "object") continue;
    if (explicitIdentityMismatch(product, requested.id)) {
      reason = "product_identity_mismatch"; continue;
    }
    if (!consistentTitle(offer.title, product.name)) {
      reason = "product_title_mismatch"; continue;
    }
    const prices = offerPrice(product);
    if (!prices.some(p => p.currency === "AED")) {
      reason = "missing_aed_price_evidence"; continue;
    }
    if (!prices.some(p => p.currency === "AED" &&
        Math.abs(p.price - Number(offer.originalProductPrice)) < 0.005)) {
      reason = "product_price_mismatch"; continue;
    }
    const image = candidateImage(product, landing.url);
    if (!image) { reason = "missing_safe_product_image"; continue; }
    return {
      accepted:true, image, reason:"verified",
      evidence: {
        productId:requested.id, strategy:String(candidate.strategy || "unknown"),
        originalPriceAED:Number(offer.originalProductPrice),
        matchedTitle:product.name, officialProductUrl:landing.url,
      },
    };
  }
  return { accepted:false, reason };
}

async function defaultLoadProduct(url, options) {
  const { extractProductDocument } = await import("../url-resolver.mjs");
  return extractProductDocument(url, options);
}

// An explicit, bounded proof run. It does not mutate persistence or activate a source.
export async function proveCarrefourAeImages(offers, {
  limit = MAX_PROBES, concurrency = MAX_CONCURRENCY, loadProduct = defaultLoadProduct,
} = {}) {
  const sample = (Array.isArray(offers) ? offers : []).slice(
    0, Math.max(0, Math.min(MAX_PROBES, Math.floor(Number(limit) || 0)))
  );
  const result = new Array(sample.length);
  let cursor = 0;
  async function worker() {
    while (cursor < sample.length) {
      const index = cursor++;
      const offer = sample[index], target = productLocation(offer?.sourceUrl);
      if (!target) { result[index] = { accepted:false, reason:"invalid_product_url" }; continue; }
      try {
        const page = await loadProduct(target.url);
        result[index] = verifyCarrefourAeImageFromPage(offer, page);
      } catch (error) {
        result[index] = { accepted:false, reason:"product_page_fetch_failed",
          detail:String(error?.message || error).slice(0, 160) };
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(
    MAX_CONCURRENCY, Math.max(1, Math.floor(Number(concurrency) || 1)), sample.length
  )}, worker));
  const accepted = result.filter(x => x?.accepted).length;
  return {
    source:"carrefour-ae", mode:"isolated-read-only",
    attempted:sample.length, accepted, rejected:sample.length - accepted,
    imageCoverage:sample.length ? accepted / sample.length : 0,
    // Results correspond positionally to the input sample; do not write them to live offers.
    results:result,
  };
}
