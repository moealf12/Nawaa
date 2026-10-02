import { resolveProductUrl } from "./url-resolver.mjs";

const EXTRACTOR_VERSION = "1.0.0";

function missingFields(offer = {}) {
  const required = ["title", "image", "productPrice", "originalCurrency", "sourceUrl"];
  const missing = required.filter((key) => offer[key] === null || offer[key] === undefined || offer[key] === "");
  if (!offer?.specs?.brand) missing.push("specs.brand");
  if (!offer.availability || offer.availability === "unknown") missing.push("availability");
  if (offer.shipping === null || offer.shipping === undefined) missing.push("shipping");
  return missing;
}

function confidenceFor(offer, missing) {
  let score = 1;
  const extraction = offer?.extraction || {};
  if (!extraction.jsonLdProductFound) score -= 0.18;
  if (!extraction.structuredPriceFound) score -= 0.3;
  if (!extraction.structuredCurrencyFound) score -= 0.18;
  if (!offer?.image) score -= 0.08;
  if (!offer?.specs?.brand) score -= 0.05;
  if (!offer?.availability || offer.availability === "unknown") score -= 0.04;
  if (missing.includes("shipping")) score -= 0.03;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function strategyFromOffer(offer = {}) {
  if (offer?.extraction?.jsonLdProductFound) return "json_ld";
  if (offer?.extraction?.structuredPriceFound) return "structured_meta";
  return "page_metadata";
}

export function toNawaaProduct(offer, inputUrl) {
  const missing = missingFields(offer);
  const confidence = confidenceFor(offer, missing);
  return {
    schemaVersion: "nawaa.product.v1",
    extractorVersion: EXTRACTOR_VERSION,
    identity: {
      title: offer.title || null,
      brand: offer?.specs?.brand || null,
      model: offer?.specs?.deviceType || null,
      modelNumber: offer?.specs?.modelNumber || null,
      gtin: offer?.specs?.barcode || null,
      color: offer?.specs?.color || null,
    },
    media: {
      primaryImage: offer.image || null,
    },
    commerce: {
      priceSAR: Number.isFinite(offer.productPrice) ? offer.productPrice : null,
      originalPrice: Number.isFinite(offer.originalProductPrice) ? offer.originalProductPrice : null,
      originalCurrency: offer.originalCurrency || null,
      shippingSAR: Number.isFinite(offer.shipping) ? offer.shipping : null,
      importCostSAR: Number.isFinite(offer.importCost) ? offer.importCost : null,
      taxSAR: Number.isFinite(offer.tax) ? offer.tax : null,
      availability: offer.availability || "unknown",
      condition: offer.condition || "unknown",
      canShipToSaudi: offer.canShipToSaudi ?? null,
    },
    source: {
      inputUrl,
      canonicalUrl: offer.sourceUrl || inputUrl,
      merchant: offer.merchant || null,
      market: offer.providerMarket || null,
      countryCode: offer.merchantCountryCode || null,
      countryNameAr: offer.merchantCountryNameAr || null,
      observedAt: offer.observedAt || new Date().toISOString(),
    },
    quality: {
      confidence,
      completeness: Number(((Math.max(0, 8 - Math.min(8, missing.length))) / 8).toFixed(3)),
      missingFields: missing,
      extractionStrategy: strategyFromOffer(offer),
      structuredEvidence: offer.extraction || {},
    },
    rawOffer: offer,
  };
}

export async function extractNawaaProduct(url) {
  const attempts = [];
  const started = Date.now();

  try {
    const offer = await resolveProductUrl(url);
    const product = toNawaaProduct(offer, url);
    attempts.push({
      strategy: product.quality.extractionStrategy,
      ok: true,
      durationMs: Date.now() - started,
      confidence: product.quality.confidence,
    });
    return {
      ok: true,
      product,
      attempts,
      observedAt: new Date().toISOString(),
    };
  } catch (error) {
    attempts.push({
      strategy: "safe_html_resolver",
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: "extraction_failed",
      message: error instanceof Error ? error.message : String(error),
      attempts,
      observedAt: new Date().toISOString(),
    };
  }
}
