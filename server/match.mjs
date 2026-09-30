export function normalizeSearchText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(\d+)\s+(gb|tb|mb|mah|mp)\b/g, "$1$2")
    .trim();
}

const ACCESSORY_TERMS = [
  "case","cover","screen protector","protector","charger","cable","adapter",
  "حافظه","كفر","شاحن","كيبل","سلك","حمايه","لزقه"
];

const UNREQUESTED_VARIANT_TERMS = [
  "pro","max","plus","ultra","air","fold","flip","fe",
  "برو","ماكس","بلس","الترا","اير"
];

export function assessOfferMatch(query, offer) {
  const normalizedQuery = normalizeSearchText(query);
  const q = normalizedQuery.split(" ").filter(Boolean);
  const title = normalizeSearchText(offer?.title || "");
  if (!q.length || !title) return { exactMatch: false, matchConfidence: 0 };

  const hits = q.filter((token) => title.includes(token)).length;
  let confidence = hits / q.length;

  const queryHasAccessoryIntent = ACCESSORY_TERMS.some((term) => normalizedQuery.includes(term));
  const titleHasAccessory = ACCESSORY_TERMS.some((term) => title.includes(term));
  if (!queryHasAccessoryIntent && titleHasAccessory) confidence *= 0.35;

  const titleTokens = new Set(title.split(" ").filter(Boolean));
  const queryTokens = new Set(q);
  const hasUnrequestedVariant = UNREQUESTED_VARIANT_TERMS.some(
    (term) => titleTokens.has(term) && !queryTokens.has(term)
  );
  if (hasUnrequestedVariant) confidence *= 0.82;

  if (offer?.condition && offer.condition !== "new") confidence -= 0.15;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    exactMatch: confidence >= 0.92 && hits === q.length &&
      !(!queryHasAccessoryIntent && titleHasAccessory) &&
      !hasUnrequestedVariant,
    matchConfidence: Math.round(confidence * 100) / 100,
  };
}

export function dedupeNormalizedOffers(offers = []) {
  const seen = new Set();
  const out = [];
  for (const offer of offers) {
    const key = normalizeSearchText([
      offer.provider,
      offer.sourceUrl,
      offer.title,
      offer.originalProductPrice,
      offer.originalCurrency,
    ].join("|"));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(offer);
  }
  return out;
}
