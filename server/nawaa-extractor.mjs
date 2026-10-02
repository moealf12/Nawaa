import { resolveProductUrl } from "./url-resolver.mjs";

const EXTRACTOR_VERSION = "2.0.0";

const STRATEGIES = [
  ["json_ld", (e) => e.jsonLdProductFound],
  ["embedded_json", (e) => e.embeddedJsonProductFound || e.nextDataProductFound || e.hydrationProductFound],
  ["storefront_data", (e) => e.storefrontProductFound || e.shopifyProductFound || e.commerceApiProductFound],
  ["domain_adapter", (e) => e.domainAdapterFound],
  ["structured_meta", (e) => e.structuredPriceFound || e.structuredCurrencyFound],
];

function missingFields(offer = {}) {
  const required = ["title", "image", "productPrice", "originalCurrency", "sourceUrl"];
  const missing = required.filter((key) => offer[key] === null || offer[key] === undefined || offer[key] === "");
  if (!offer?.specs?.brand) missing.push("specs.brand");
  if (!offer.availability || offer.availability === "unknown") missing.push("availability");
  if (offer.shipping === null || offer.shipping === undefined) missing.push("shipping");
  return missing;
}

function evidenceCount(extraction = {}) {
  return Object.values(extraction).filter(Boolean).length;
}

function confidenceFor(offer, missing) {
  const extraction = offer?.extraction || {};
  let score = 0.35;
  if (extraction.jsonLdProductFound) score += 0.28;
  if (extraction.embeddedJsonProductFound || extraction.nextDataProductFound || extraction.hydrationProductFound) score += 0.22;
  if (extraction.storefrontProductFound || extraction.shopifyProductFound || extraction.commerceApiProductFound) score += 0.2;
  if (extraction.domainAdapterFound) score += 0.18;
  if (extraction.structuredPriceFound) score += 0.12;
  if (extraction.structuredCurrencyFound) score += 0.08;
  if (offer?.image) score += 0.04;
  if (offer?.specs?.brand) score += 0.03;
  if (offer?.availability && offer.availability !== "unknown") score += 0.02;
  if (!missing.includes("shipping")) score += 0.01;
  score -= Math.min(0.3, missing.length * 0.035);
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

export function strategyFromOffer(offer = {}) {
  const extraction = offer?.extraction || {};
  return STRATEGIES.find(([, matches]) => matches(extraction))?.[0] || "page_metadata";
}

function extractionTrail(offer = {}) {
  const extraction = offer?.extraction || {};
  const seen = STRATEGIES.filter(([, matches]) => matches(extraction)).map(([name]) => name);
  if (!seen.length) seen.push("page_metadata");
  return seen;
}

export function buildExtractionDiagnostics(product) {
  const extraction = product?.rawOffer?.extraction || {};
  return {
    selectedStrategy: product?.quality?.extractionStrategy || extraction.strategy || "unknown",
    selectionReason: extraction.selectionReason || null,
    adapterId: extraction.domainAdapterId || null,
    availableDomainAdapters: extraction.availableDomainAdapters || [],
    attemptedStrategies: extraction.attemptedStrategies || [],
    availableStrategies: extraction.availableStrategies || [],
    reconciled: Boolean(extraction.reconciled),
    contributingStrategies: extraction.contributingStrategies || [],
    fieldSources: extraction.fieldSources || {},
    conflicts: extraction.conflicts || [],
    conflictSummary: extraction.conflictSummary || {
      hasConflicts:false,
      count:0,
      highSeverity:0,
      fields:[],
    },
    freshness: extraction.freshness || {
      freshestObservedAt:null,
      staleSources:[],
      unknownFreshnessSources:[],
      sources:[],
    },
    missingFields: product?.quality?.missingFields || [],
    confidence: product?.quality?.confidence ?? null,
    completeness: product?.quality?.completeness ?? null,
  };
}

export function toNawaaProduct(offer, inputUrl) {
  const missing = missingFields(offer);
  const confidence = confidenceFor(offer, missing);
  const strategy = strategyFromOffer(offer);
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
    media: { primaryImage: offer.image || null },
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
      extractionStrategy: strategy,
      extractionTrail: extractionTrail(offer),
      evidenceCount: evidenceCount(offer.extraction || {}),
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
      trail: product.quality.extractionTrail,
      ok: true,
      durationMs: Date.now() - started,
      confidence: product.quality.confidence,
    });
    return {
      ok: true,
      product,
      diagnostics: buildExtractionDiagnostics(product),
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
