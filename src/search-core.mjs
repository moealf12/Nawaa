const BUCKET_ORDER = {
  confirmed: 0,
  estimated: 1,
  probable: 2,
  incomplete: 3,
  ineligible: 4,
};

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLikelyUrl(value = "") {
  try {
    const url = new URL(String(value).trim());
    return /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
}

export function tokenize(value = "") {
  return normalizeText(value).split(" ").filter(Boolean);
}

export function productMatchScore(query, product) {
  const q = tokenize(query);
  if (!q.length) return 0;

  const haystack = normalizeText([
    product.brand,
    product.model,
    product.variant,
    product.nameAr,
    product.nameEn,
    ...(product.aliases || []),
    ...(product.identifiers || []),
  ].filter(Boolean).join(" "));

  let hits = 0;
  for (const token of q) {
    if (haystack.includes(token)) hits += 1;
  }

  const coverage = hits / q.length;
  const identifierHit = (product.identifiers || [])
    .map(normalizeText)
    .some((id) => id && normalizeText(query).includes(id));

  return Math.min(1, coverage + (identifierHit ? 0.2 : 0));
}

export function calculateComparableTotal(offer) {
  const components = [
    offer.productPrice,
    offer.shipping,
    offer.importCost,
    offer.tax,
    offer.mandatoryFees,
    offer.discount,
  ];

  if (!Number.isFinite(offer.productPrice)) return null;

  const required = [offer.shipping, offer.importCost, offer.tax, offer.mandatoryFees];
  if (required.some((v) => !Number.isFinite(v))) return null;

  return Math.max(
    0,
    offer.productPrice +
      offer.shipping +
      offer.importCost +
      offer.tax +
      offer.mandatoryFees -
      (Number.isFinite(offer.discount) ? offer.discount : 0)
  );
}

export function classifyOffer(offer) {
  if (
    offer.canShipToSaudi === false ||
    offer.availability === "out_of_stock" ||
    offer.condition !== "new"
  ) {
    return "ineligible";
  }

  if (offer.matchConfidence < 0.9 || offer.exactMatch !== true) {
    return "probable";
  }

  const total = calculateComparableTotal(offer);
  if (total === null) return "incomplete";

  if (offer.priceConfidence === "estimated") return "estimated";
  return "confirmed";
}

export function enrichOffer(offer) {
  return {
    ...offer,
    totalSAR: calculateComparableTotal(offer),
    bucket: classifyOffer(offer),
  };
}

export function rankOffers(offers = [], mode = "lowest") {
  const enriched = offers.map(enrichOffer);

  return enriched.sort((a, b) => {
    const bucketDelta = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucketDelta !== 0) return bucketDelta;

    if (mode === "fastest") {
      const etaA = Number.isFinite(a.deliveryDays) ? a.deliveryDays : Infinity;
      const etaB = Number.isFinite(b.deliveryDays) ? b.deliveryDays : Infinity;
      if (etaA !== etaB) return etaA - etaB;
    }

    if (mode === "local") {
      const localDelta = Number(Boolean(b.isLocal)) - Number(Boolean(a.isLocal));
      if (localDelta !== 0) return localDelta;
    }

    const totalA = Number.isFinite(a.totalSAR) ? a.totalSAR : Infinity;
    const totalB = Number.isFinite(b.totalSAR) ? b.totalSAR : Infinity;
    if (totalA !== totalB) return totalA - totalB;

    const advertisedA = Number.isFinite(a.productPrice) ? a.productPrice : Infinity;
    const advertisedB = Number.isFinite(b.productPrice) ? b.productPrice : Infinity;
    if (advertisedA !== advertisedB) return advertisedA - advertisedB;

    return (b.matchConfidence || 0) - (a.matchConfidence || 0);
  });
}

function normalizeVariantPart(value = "") {
  return normalizeText(value)
    .replace(/\b(\d+)\s+(gb|tb|mb)\b/g, "$1$2")
    .trim();
}

function normalizedBrand(value = "") {
  return normalizeVariantPart(value).replace(/\s+/g, " ");
}

function normalizedModel(offer = {}) {
  const specs = offer.specs || {};
  let raw = specs.deviceType || specs.model || specs.series || offer.title || "";
  let model = normalizeVariantPart(raw);

  if (["smartphone", "phone", "mobile", "جوال", "هاتف"].includes(model)) {
    model = normalizeVariantPart(specs.series || offer.title || "");
  }

  const brand = normalizedBrand(specs.brand || "");
  if (brand && model.startsWith(brand + " ")) model = model.slice(brand.length + 1).trim();

  return model || "unknown-model";
}

export function offerVariantKey(offer = {}) {
  const specs = offer.specs || {};
  return [
    normalizedBrand(specs.brand || ""),
    normalizedModel(offer),
    normalizeVariantPart(specs.storage || ""),
    normalizeVariantPart(specs.color || ""),
    normalizeVariantPart(offer.condition || "unknown"),
  ].join("|");
}

export function groupComparableOffers(offers = [], mode = "lowest") {
  const ranked = rankOffers(offers, mode);
  const groups = new Map();

  for (const offer of ranked) {
    const key = offerVariantKey(offer);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }

  return [...groups.entries()].map(([key, groupedOffers]) => {
    const ordered = rankOffers(groupedOffers, mode);
    const bestOffer = ordered[0] || null;
    const secondOffer = ordered[1] || null;
    const usesComparableTotal = Boolean(bestOffer && Number.isFinite(bestOffer.totalSAR));
    const bestValue = bestOffer
      ? (usesComparableTotal ? bestOffer.totalSAR : bestOffer.productPrice)
      : null;
    const secondValue = secondOffer
      ? (Number.isFinite(secondOffer.totalSAR) ? secondOffer.totalSAR : secondOffer.productPrice)
      : null;

    return {
      key,
      offers: ordered,
      bestOffer,
      merchantCount: new Set(ordered.map((offer) => offer.merchant).filter(Boolean)).size,
      priceBasis: usesComparableTotal ? "comparable_total" : "advertised_price",
      bestValue: Number.isFinite(bestValue) ? bestValue : null,
      savingsToNext: Number.isFinite(bestValue) && Number.isFinite(secondValue) && secondValue > bestValue
        ? secondValue - bestValue
        : null,
    };
  }).sort((a, b) => {
    const aExact = a.bestOffer?.exactMatch === true ? 0 : 1;
    const bExact = b.bestOffer?.exactMatch === true ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    const aValue = Number.isFinite(a.bestValue) ? a.bestValue : Infinity;
    const bValue = Number.isFinite(b.bestValue) ? b.bestValue : Infinity;
    if (aValue !== bValue) return aValue - bValue;

    return (b.bestOffer?.matchConfidence || 0) - (a.bestOffer?.matchConfidence || 0);
  });
}

export function summarizeOffers(offers = []) {
  const enriched = offers.map(enrichOffer);
  const ranked = rankOffers(offers);
  const confirmed = ranked.filter((o) => o.bucket === "confirmed");
  const sources = new Set(enriched.map((o) => o.merchant).filter(Boolean));

  return {
    count: enriched.length,
    sources: sources.size,
    confirmedCount: confirmed.length,
    bestConfirmed: confirmed[0] || null,
  };
}

export function findBestProduct(query, catalog = []) {
  let best = null;

  for (const product of catalog) {
    const score = productMatchScore(query, product);
    if (!best || score > best.score) best = { product, score };
  }

  return best && best.score >= 0.5 ? best : null;
}

export const DEMO_CATALOG = [
  {
    id: "iphone-17",
    brand: "Apple",
    model: "iPhone 17",
    variant: "Base model",
    nameAr: "Apple iPhone 17",
    nameEn: "Apple iPhone 17",
    aliases: ["ايفون 17", "آيفون 17", "iphone17", "iphone 17"],
    identifiers: ["IPHONE17"],
    imageLabel: "IPHONE 17",
    offers: [
      {
        merchant: "Apple Store السعودية",
        merchantCountryCode: "SA",
        merchantCountryNameAr: "السعودية",
        sourceUrl: "https://www.apple.com/sa-ar/shop/buy-iphone",
        dataKind: "verified_source",
        productPrice: 4299,
        shipping: null,
        importCost: 0,
        tax: 0,
        mandatoryFees: 0,
        discount: 0,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: null,
        exactMatch: true,
        matchConfidence: 0.99,
        priceConfidence: "confirmed",
        isLocal: true,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
    ],
  },
  {
    id: "airpods-pro-2-usbc",
    brand: "Apple",
    model: "AirPods Pro 2",
    variant: "USB-C",
    nameAr: "آبل إيربودز برو الجيل الثاني USB-C",
    nameEn: "Apple AirPods Pro 2 USB-C",
    aliases: ["ايربودز برو 2", "airpods pro second generation", "airpods pro usb c"],
    identifiers: ["MTJV3"],
    imageLabel: "AIRPODS PRO 2",
    offers: [
      {
        merchant: "متجر محلي A — Demo",
        merchantCountryCode: "SA",
        merchantCountryNameAr: "السعودية",
        productPrice: 899,
        shipping: 0,
        importCost: 0,
        tax: 0,
        mandatoryFees: 0,
        discount: 20,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: 2,
        exactMatch: true,
        matchConfidence: 0.99,
        priceConfidence: "confirmed",
        isLocal: true,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
      {
        merchant: "متجر إماراتي B — Demo",
        merchantCountryCode: "AE",
        merchantCountryNameAr: "الإمارات",
        productPrice: 885,
        shipping: 25,
        importCost: 0,
        tax: 0,
        mandatoryFees: 0,
        discount: 0,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: 1,
        exactMatch: true,
        matchConfidence: 0.98,
        priceConfidence: "confirmed",
        isLocal: true,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
      {
        merchant: "متجر أمريكي C — Demo",
        merchantCountryCode: "US",
        merchantCountryNameAr: "الولايات المتحدة",
        productPrice: 790,
        shipping: 78,
        importCost: 36,
        tax: 0,
        mandatoryFees: 12,
        discount: 0,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: 7,
        exactMatch: true,
        matchConfidence: 0.95,
        priceConfidence: "estimated",
        isLocal: false,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
      {
        merchant: "نتيجة صينية محتملة D — Demo",
        merchantCountryCode: "CN",
        merchantCountryNameAr: "الصين",
        productPrice: 749,
        shipping: null,
        importCost: null,
        tax: null,
        mandatoryFees: null,
        discount: 0,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: null,
        exactMatch: false,
        matchConfidence: 0.76,
        priceConfidence: "unknown",
        isLocal: false,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
    ],
  },
  {
    id: "dyson-v15-detect",
    brand: "Dyson",
    model: "V15 Detect",
    variant: "Absolute",
    nameAr: "دايسون V15 ديتكت أبسولوت",
    nameEn: "Dyson V15 Detect Absolute",
    aliases: ["دايسون v15", "dyson v15", "v15 detect"],
    identifiers: ["V15"],
    imageLabel: "DYSON V15",
    offers: [
      {
        merchant: "متجر محلي A — Demo",
        merchantCountryCode: "SA",
        merchantCountryNameAr: "السعودية",
        productPrice: 2299,
        shipping: 0,
        importCost: 0,
        tax: 0,
        mandatoryFees: 0,
        discount: 100,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: 3,
        exactMatch: true,
        matchConfidence: 0.98,
        priceConfidence: "confirmed",
        isLocal: true,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
      {
        merchant: "متجر ألماني B — Demo",
        merchantCountryCode: "DE",
        merchantCountryNameAr: "ألمانيا",
        productPrice: 1980,
        shipping: 140,
        importCost: 70,
        tax: 0,
        mandatoryFees: 25,
        discount: 0,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: 8,
        exactMatch: true,
        matchConfidence: 0.96,
        priceConfidence: "estimated",
        isLocal: false,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
    ],
  },
  {
    id: "ps5-slim-disc",
    brand: "Sony",
    model: "PlayStation 5 Slim",
    variant: "Disc Edition",
    nameAr: "بلايستيشن 5 سليم نسخة الأقراص",
    nameEn: "Sony PlayStation 5 Slim Disc Edition",
    aliases: ["ps5 slim disc", "بلايستيشن 5 سليم", "بي اس 5 سليم"],
    identifiers: ["CFI-2016"],
    imageLabel: "PS5 SLIM",
    offers: [
      {
        merchant: "متجر محلي A — Demo",
        merchantCountryCode: "SA",
        merchantCountryNameAr: "السعودية",
        productPrice: 1999,
        shipping: 0,
        importCost: 0,
        tax: 0,
        mandatoryFees: 0,
        discount: 0,
        currency: "SAR",
        condition: "new",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: 2,
        exactMatch: true,
        matchConfidence: 0.99,
        priceConfidence: "confirmed",
        isLocal: true,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
      {
        merchant: "نتيجة يابانية Open Box — Demo",
        merchantCountryCode: "JP",
        merchantCountryNameAr: "اليابان",
        productPrice: 1699,
        shipping: 0,
        importCost: 0,
        tax: 0,
        mandatoryFees: 0,
        discount: 0,
        currency: "SAR",
        condition: "open_box",
        availability: "in_stock",
        canShipToSaudi: true,
        deliveryDays: 2,
        exactMatch: true,
        matchConfidence: 0.99,
        priceConfidence: "confirmed",
        isLocal: true,
        observedAt: "2026-09-30T00:00:00+03:00",
      },
    ],
  },
];
