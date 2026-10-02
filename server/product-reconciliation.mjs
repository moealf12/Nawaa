import { choosePreferredCandidate } from "./conflict-resolution.mjs";
import { identityCluster } from "./product-identity.mjs";

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function firstImage(value) {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value)) return firstImage(value[0]);
  if (value && typeof value === "object") return value.url || value.src || null;
  return null;
}

function normalizedBrand(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || value.title || null;
  return null;
}

function ranked(candidates = []) {
  return [...candidates].sort((a,b) => (b.confidence || 0) - (a.confidence || 0));
}

function pick(entries, getter, field = "identity") {
  const eligible = entries.filter((entry) => hasValue(getter(entry.product)));
  const preferred = choosePreferredCandidate(eligible, field);
  if (preferred) {
    return {
      value:getter(preferred.product),
      strategy:preferred.strategy,
      adapterId:preferred.adapterId || null,
    };
  }
  return { value:null, strategy:null, adapterId:null };
}

function chooseOffer(product) {
  const raw = product?.offers;
  const offers = Array.isArray(raw) ? raw : raw?.offers && Array.isArray(raw.offers) ? raw.offers : raw ? [raw] : [];
  for (const offer of offers) {
    const price = Number(offer?.price ?? offer?.lowPrice ?? offer?.highPrice);
    const currency = offer?.priceCurrency || null;
    if (Number.isFinite(price) && currency) return offer;
  }
  return null;
}

export function reconcileProductCandidates(candidates = [], selectedEntry = null) {
  if (!candidates.length) {
    return {
      product:null,
      fieldSources:{},
      contributingStrategies:[],
      reconciled:false,
      identity:{ anchor:null, accepted:[], rejected:[], comparisons:[], summary:{accepted:0,rejected:0} },
    };
  }

  const identity = identityCluster(candidates, selectedEntry);
  const compatibleCandidates = identity.accepted.length ? identity.accepted : candidates;

  const priceEntry = choosePreferredCandidate(
    compatibleCandidates,
    "price",
    (entry) => Boolean(chooseOffer(entry.product))
  ) || selectedEntry || ranked(compatibleCandidates).find((entry) => chooseOffer(entry.product)) || compatibleCandidates[0];
  const priceOffer = chooseOffer(priceEntry?.product);

  const fields = {
    name: pick(compatibleCandidates, (p) => p?.name, "name"),
    image: pick(compatibleCandidates, (p) => firstImage(p?.image), "identity"),
    brand: pick(compatibleCandidates, (p) => normalizedBrand(p?.brand), "identity"),
    model: pick(compatibleCandidates, (p) => typeof p?.model === "string" ? p.model : p?.model?.name, "identity"),
    color: pick(compatibleCandidates, (p) => p?.color, "identity"),
    mpn: pick(compatibleCandidates, (p) => p?.mpn || p?.sku, "identity"),
    gtin13: pick(compatibleCandidates, (p) => p?.gtin13, "identity"),
    gtin14: pick(compatibleCandidates, (p) => p?.gtin14, "identity"),
    gtin: pick(compatibleCandidates, (p) => p?.gtin, "identity"),
  };

  const product = {
    ...(priceEntry?.product || {}),
    name: fields.name.value,
    image: fields.image.value,
    brand: fields.brand.value,
    model: fields.model.value,
    color: fields.color.value,
    mpn: fields.mpn.value,
    gtin13: fields.gtin13.value,
    gtin14: fields.gtin14.value,
    gtin: fields.gtin.value,
    offers: priceOffer || priceEntry?.product?.offers || null,
  };

  const fieldSources = Object.fromEntries(
    Object.entries(fields).map(([field, source]) => [
      field,
      source.strategy ? { strategy:source.strategy, adapterId:source.adapterId } : null,
    ])
  );
  fieldSources.offers = priceEntry
    ? { strategy:priceEntry.strategy, adapterId:priceEntry.adapterId || null }
    : null;

  const contributingStrategies = [...new Set(
    Object.values(fieldSources).filter(Boolean).map((source) =>
      source.adapterId ? `${source.strategy}:${source.adapterId}` : source.strategy
    )
  )];

  return {
    product,
    fieldSources,
    contributingStrategies,
    reconciled: contributingStrategies.length > 1,
    identity,
  };
}
