import { normalizeSearchQuery } from "../src/search-query.mjs";
export { assessOfferMatch } from "../src/search-query.mjs";
export const normalizeSearchText = normalizeSearchQuery;

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
