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
    .trim();
}

const ACCESSORY_TERMS = [
  "case","cover","screen protector","protector","charger","cable","adapter",
  "حافظه","كفر","شاحن","كيبل","سلك","حمايه","لزقه"
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

  if (offer?.condition && offer.condition !== "new") confidence -= 0.15;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    exactMatch: confidence >= 0.92 && hits === q.length && !(!queryHasAccessoryIntent && titleHasAccessory),
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
