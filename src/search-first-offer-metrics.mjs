// Pure, diagnostic-only first-offer classification shared by the server and
// isolated HTTP timing harness. Does not modify, sort or filter actual offers.
export function structurallyValidOffer(offer) {
  return offer && typeof offer.title === 'string' && offer.title.trim().length > 0 &&
    Number.isFinite(offer.productPrice) && offer.productPrice > 0 &&
    offer.currency === 'SAR' &&
    typeof offer.merchant === 'string' && offer.merchant.trim().length > 0 &&
    offer.merchant !== 'App' &&
    typeof offer.sourceUrl === 'string' && offer.sourceUrl.startsWith('https://') &&
    typeof offer.observedAt === 'string' && Number.isFinite(Date.parse(offer.observedAt));
}

export function firstOfferMilestones(offers = []) {
  let firstValid = null, firstExact = null, validCount = 0, exactCount = 0;
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (!structurallyValidOffer(offer)) continue;
    validCount++;
    if (firstValid === null) firstValid = offer;
    if (offer.exactMatch === true) {
      exactCount++;
      if (firstExact === null) firstExact = offer;
    }
  }
  return {firstValid,firstExact,validCount,exactCount};
}
