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

export function offerVariantFamilyKey(offer = {}) {
  const specs = offer.specs || {};
  return [
    normalizedBrand(specs.brand || ""),
    normalizedModel(offer),
    normalizeVariantPart(specs.storage || ""),
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
    const priceOrdered = rankOffers(groupedOffers, "lowest");
    const bestOffer = ordered[0] || null;
    const bestPriceOffer = priceOrdered[0] || null;
    const secondPriceOffer = priceOrdered[1] || null;
    const usesComparableTotal = Boolean(bestPriceOffer && Number.isFinite(bestPriceOffer.totalSAR));
    const bestValue = bestPriceOffer
      ? (usesComparableTotal ? bestPriceOffer.totalSAR : bestPriceOffer.productPrice)
      : null;
    const secondValue = secondPriceOffer
      ? (Number.isFinite(secondPriceOffer.totalSAR) ? secondPriceOffer.totalSAR : secondPriceOffer.productPrice)
      : null;

    const fastestOffer = [...ordered]
      .filter((offer) => Number.isFinite(offer.deliveryDays))
      .sort((a, b) => a.deliveryDays - b.deliveryDays)[0] || null;

    return {
      key,
      offers: ordered,
      bestOffer,
      bestPriceOffer,
      fastestOffer,
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

function offerDisplayValue(offer = {}) {
  if (Number.isFinite(offer.totalSAR)) return offer.totalSAR;
  if (Number.isFinite(offer.productPrice)) return offer.productPrice;
  return null;
}

function missingCostComponents(offer = {}) {
  const fields = [
    ["shipping", "الشحن"],
    ["importCost", "الاستيراد"],
    ["tax", "الضريبة"],
    ["mandatoryFees", "الرسوم الإلزامية"],
  ];
  return fields.filter(([key]) => !Number.isFinite(offer[key])).map(([, label]) => label);
}

export function buildOfferIntelligence(group = {}) {
  const offers = Array.isArray(group.offers) ? group.offers : [];
  const priceOrdered = [...offers].sort((a, b) => {
    const aTotal = Number.isFinite(a.totalSAR) ? a.totalSAR : Infinity;
    const bTotal = Number.isFinite(b.totalSAR) ? b.totalSAR : Infinity;
    if (aTotal !== bTotal) return aTotal - bTotal;
    const aPrice = Number.isFinite(a.productPrice) ? a.productPrice : Infinity;
    const bPrice = Number.isFinite(b.productPrice) ? b.productPrice : Infinity;
    return aPrice - bPrice;
  });

  const baselineOffer = group.bestPriceOffer || priceOrdered[0] || null;
  const baselineValue = offerDisplayValue(baselineOffer);
  const priceBasis = baselineOffer && Number.isFinite(baselineOffer.totalSAR)
    ? "comparable_total"
    : "advertised_price";

  const rows = offers.map((offer) => {
    const value = offerDisplayValue(offer);
    const delta = Number.isFinite(value) && Number.isFinite(baselineValue) ? value - baselineValue : null;
    const deltaPercent = Number.isFinite(delta) && delta > 0 && baselineValue > 0
      ? (delta / baselineValue) * 100
      : 0;
    const missingCosts = missingCostComponents(offer);
    const badges = [];
    const warnings = [];

    if (offer === baselineOffer) badges.push(priceBasis === "comparable_total" ? "أقل إجمالي مؤكد" : "أقل سعر معلن");
    if (offer.sourceMeta?.jeddahInStock === true) badges.push("متوفر في جدة");
    if (offer.sourceMeta?.homeDeliveryEnabled === true) badges.push("توصيل منزلي");
    if (offer.sourceMeta?.collectFromStoreEnabled === true) badges.push("استلام من المعرض");
    if (offer.exactMatch === true && (offer.matchConfidence || 0) >= 0.92) badges.push("مطابقة عالية");
    if (Number.isFinite(offer.deliveryDays)) badges.push(offer.deliveryDays + " يوم");

    if (offer.sourceMeta?.jeddahInStock === false) warnings.push("غير متوفر حاليًا في جدة");
    if (offer.availability === "out_of_stock") warnings.push("غير متوفر لدى المتجر");
    if (offer.availability === "unknown" && offer.sourceMeta?.jeddahInStock !== true) warnings.push("التوفر التفصيلي غير مؤكد");
    if (offer.canShipToSaudi === false) warnings.push("لا يشحن إلى السعودية");
    if (offer.canShipToSaudi == null) warnings.push("الشحن إلى السعودية غير مؤكد");
    if (missingCosts.length) warnings.push("تكلفة غير مكتملة: " + missingCosts.join("، "));
    if (offer.exactMatch !== true || (offer.matchConfidence || 0) < 0.9) warnings.push("مطابقة المنتج تحتاج تحقق");

    return {
      offer,
      value,
      delta: Number.isFinite(delta) ? delta : null,
      deltaPercent: Math.round(deltaPercent * 10) / 10,
      priceBasis: Number.isFinite(offer.totalSAR) ? "comparable_total" : "advertised_price",
      missingCosts,
      badges,
      warnings,
    };
  });

  const insights = [];
  const secondPriced = priceOrdered.find((offer) => offer !== baselineOffer && Number.isFinite(offerDisplayValue(offer)));
  const secondValue = offerDisplayValue(secondPriced);
  if (baselineOffer && Number.isFinite(baselineValue)) {
    if (secondPriced && Number.isFinite(secondValue) && secondValue > baselineValue) {
      const diff = secondValue - baselineValue;
      const pct = baselineValue > 0 ? Math.round((diff / baselineValue) * 1000) / 10 : 0;
      insights.push({
        type: "price",
        tone: "positive",
        title: priceBasis === "comparable_total" ? "أقل إجمالي مؤكد" : "أقل سعر معلن",
        text: String(baselineOffer.merchant || "العرض الأول") + " أقل بـ " + diff.toFixed(2) + " ر.س (" + pct + "%) من " + String(secondPriced.merchant || "العرض التالي"),
      });
    } else {
      insights.push({
        type: "price",
        tone: "neutral",
        title: priceBasis === "comparable_total" ? "إجمالي قابل للمقارنة" : "السعر المعلن",
        text: "لا يوجد عرض ثانٍ بسعر صالح لقياس الفرق حاليًا.",
      });
    }
  }

  const jeddah = offers.filter((offer) => offer.sourceMeta?.jeddahInStock === true);
  if (jeddah.length) {
    insights.push({
      type: "availability",
      tone: "positive",
      title: "توفر مؤكد في جدة",
      text: [...new Set(jeddah.map((offer) => offer.merchant).filter(Boolean))].join("، "),
    });
  } else {
    insights.push({
      type: "availability",
      tone: "warning",
      title: "توفر جدة غير محسوم",
      text: "لا يوجد مصدر في هذه المقارنة يؤكد مخزون جدة حاليًا.",
    });
  }

  const delivery = offers.filter((offer) => offer.sourceMeta?.homeDeliveryEnabled === true);
  const pickup = offers.filter((offer) => offer.sourceMeta?.collectFromStoreEnabled === true);
  if (delivery.length || pickup.length) {
    const parts = [];
    if (delivery.length) parts.push("توصيل منزلي: " + [...new Set(delivery.map((offer) => offer.merchant).filter(Boolean))].join("، "));
    if (pickup.length) parts.push("استلام من المعرض: " + [...new Set(pickup.map((offer) => offer.merchant).filter(Boolean))].join("، "));
    insights.push({
      type: "delivery",
      tone: "positive",
      title: "خيارات الاستلام",
      text: parts.join(" · "),
    });
  }

  const incompleteCount = rows.filter((row) => row.missingCosts.length).length;
  if (incompleteCount) {
    insights.push({
      type: "cost",
      tone: "warning",
      title: "التكلفة النهائية غير مكتملة",
      text: incompleteCount === offers.length
        ? "كل العروض تحتاج تأكيد بعض مكونات الشحن أو الرسوم قبل وصف أحدها بأنه الأرخص نهائيًا."
        : incompleteCount + " من " + offers.length + " عروض تحتاج استكمال بعض مكونات التكلفة.",
    });
  }

  return {
    baselineOffer,
    baselineValue,
    priceBasis,
    rows,
    insights,
  };
}

export function offerVariantDimensions(offer = {}) {
  const specs = offer.specs || {};
  const modelLabel = String(specs.deviceType || specs.model || specs.series || offer.title || "غير محدد").trim();
  const storageLabel = String(specs.storage || "غير محدد").trim();
  const colorLabel = String(specs.color || "غير محدد").trim();
  const conditionLabel = String(offer.condition || "unknown").trim();

  return {
    modelKey: normalizedModel(offer),
    modelLabel,
    storageKey: normalizeVariantPart(storageLabel),
    storageLabel,
    colorKey: normalizeVariantPart(colorLabel),
    colorLabel,
    conditionKey: normalizeVariantPart(conditionLabel),
    conditionLabel,
  };
}

function facetOptions(entries, keyName, labelName) {
  const map = new Map();
  for (const entry of entries) {
    const key = entry.dimensions[keyName];
    const label = entry.dimensions[labelName];
    if (!key || !label) continue;
    if (!map.has(key)) {
      map.set(key, {
        key,
        label,
        groups: 0,
        merchants: new Set(),
        minPrice: Infinity,
      });
    }
    const item = map.get(key);
    item.groups += 1;
    for (const offer of entry.group.offers || []) {
      if (offer.merchant) item.merchants.add(offer.merchant);
    }
    if (Number.isFinite(entry.group.bestValue)) item.minPrice = Math.min(item.minPrice, entry.group.bestValue);
  }

  return [...map.values()].map((item) => ({
    key: item.key,
    label: item.label,
    groups: item.groups,
    merchantCount: item.merchants.size,
    minPrice: Number.isFinite(item.minPrice) ? item.minPrice : null,
  })).sort((a, b) => {
    const aPrice = Number.isFinite(a.minPrice) ? a.minPrice : Infinity;
    const bPrice = Number.isFinite(b.minPrice) ? b.minPrice : Infinity;
    if (aPrice !== bPrice) return aPrice - bPrice;
    return String(a.label).localeCompare(String(b.label));
  });
}

function pickFacetKey(requestedKey, options, fallbackKey) {
  if (requestedKey && options.some((option) => option.key === requestedKey)) return requestedKey;
  if (fallbackKey && options.some((option) => option.key === fallbackKey)) return fallbackKey;
  return options[0]?.key || "";
}

export function buildVariantSelectorState(variantGroups = [], requested = {}) {
  const entries = variantGroups
    .filter((group) => group?.bestOffer)
    .map((group) => ({
      group,
      dimensions: offerVariantDimensions(group.bestOffer),
    }));

  if (!entries.length) {
    return {
      selection: {},
      options: { models: [], storages: [], colors: [], conditions: [] },
      selectedGroup: null,
    };
  }

  const fallbackEntry =
    entries.find((entry) => entry.group.bestOffer?.exactMatch === true && entry.group.bestOffer?.condition === "new")
    || entries[0];

  const models = facetOptions(entries, "modelKey", "modelLabel");
  const modelKey = pickFacetKey(requested.modelKey, models, fallbackEntry.dimensions.modelKey);
  const modelEntries = entries.filter((entry) => entry.dimensions.modelKey === modelKey);

  const storages = facetOptions(modelEntries, "storageKey", "storageLabel");
  const storageKey = pickFacetKey(requested.storageKey, storages, fallbackEntry.dimensions.storageKey);
  const storageEntries = modelEntries.filter((entry) => entry.dimensions.storageKey === storageKey);

  const conditions = facetOptions(storageEntries, "conditionKey", "conditionLabel");
  const conditionKey = pickFacetKey(requested.conditionKey, conditions, fallbackEntry.dimensions.conditionKey);
  const conditionEntries = storageEntries.filter((entry) => entry.dimensions.conditionKey === conditionKey);

  const colors = facetOptions(conditionEntries, "colorKey", "colorLabel");
  const colorKey = pickFacetKey(requested.colorKey, colors, fallbackEntry.dimensions.colorKey);

  const selectedEntry =
    conditionEntries.find((entry) => entry.dimensions.colorKey === colorKey)
    || conditionEntries[0]
    || storageEntries[0]
    || modelEntries[0]
    || entries[0];

  return {
    selection: {
      modelKey: selectedEntry?.dimensions.modelKey || modelKey,
      storageKey: selectedEntry?.dimensions.storageKey || storageKey,
      colorKey: selectedEntry?.dimensions.colorKey || colorKey,
      conditionKey: selectedEntry?.dimensions.conditionKey || conditionKey,
    },
    labels: selectedEntry?.dimensions || {},
    options: { models, storages, colors, conditions },
    selectedGroup: selectedEntry?.group || null,
  };
}

function canonicalSpecNorm(value = "") {
  return normalizeVariantPart(value)
    .replace(/\binches?\b/g, "inch")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCanonicalProductProfile(offers = []) {
  const fields = [
    "brand","series","deviceType","storage","color","ram","processor","screenSize","screenType",
    "network","sim","operatingSystem","rearCamera","frontCamera","battery","waterproof","modelNumber","barcode"
  ];
  const profile = {};

  for (const field of fields) {
    const candidates = new Map();

    for (const offer of offers) {
      const raw = offer?.specs?.[field];
      if (raw === null || raw === undefined || String(raw).trim() === "") continue;
      const value = String(raw).trim();
      const normalized = canonicalSpecNorm(value);
      if (!normalized) continue;

      if (!candidates.has(normalized)) {
        candidates.set(normalized, {
          value,
          normalized,
          sources: new Set(),
          observations: 0,
        });
      }
      const candidate = candidates.get(normalized);
      candidate.observations += 1;
      if (offer.merchant) candidate.sources.add(offer.merchant);

      // Keep the more specific display value when normalized values collapse together.
      if (value.length > candidate.value.length) candidate.value = value;
    }

    const ranked = [...candidates.values()].sort((a, b) => {
      if (b.sources.size !== a.sources.size) return b.sources.size - a.sources.size;
      if (b.observations !== a.observations) return b.observations - a.observations;
      return b.value.length - a.value.length;
    });

    if (!ranked.length) continue;
    const chosen = ranked[0];
    profile[field] = {
      value: chosen.value,
      sources: [...chosen.sources],
      conflict: ranked.length > 1,
      alternatives: ranked.slice(1).map((candidate) => ({
        value: candidate.value,
        sources: [...candidate.sources],
      })),
    };
  }

  return profile;
}

export function groupVariantFamilies(variantGroups = []) {
  const families = new Map();

  for (const group of variantGroups) {
    const offer = group?.bestOffer || group?.offers?.[0];
    if (!offer) continue;
    const key = offerVariantFamilyKey(offer);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(group);
  }

  return [...families.entries()].map(([key, variants]) => {
    const ordered = [...variants].sort((a, b) => {
      const aValue = Number.isFinite(a.bestValue) ? a.bestValue : Infinity;
      const bValue = Number.isFinite(b.bestValue) ? b.bestValue : Infinity;
      if (aValue !== bValue) return aValue - bValue;
      const aColor = normalizeVariantPart(a.bestOffer?.specs?.color || "");
      const bColor = normalizeVariantPart(b.bestOffer?.specs?.color || "");
      return aColor.localeCompare(bColor);
    });

    const allOffers = ordered.flatMap((variant) => variant.offers || []);
    const representative = ordered[0]?.bestOffer || null;

    return {
      key,
      variants: ordered,
      defaultVariantKey: ordered[0]?.key || null,
      representative,
      merchantCount: new Set(allOffers.map((offer) => offer.merchant).filter(Boolean)).size,
      offerCount: allOffers.length,
    };
  }).sort((a, b) => {
    const aOffer = a.representative;
    const bOffer = b.representative;
    const aExact = aOffer?.exactMatch === true ? 0 : 1;
    const bExact = bOffer?.exactMatch === true ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    const aValue = Number.isFinite(a.variants[0]?.bestValue) ? a.variants[0].bestValue : Infinity;
    const bValue = Number.isFinite(b.variants[0]?.bestValue) ? b.variants[0].bestValue : Infinity;
    return aValue - bValue;
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
