// Keep the shopper's first results diversified across independently identified
// merchants, without allowing weak matches or accessories to outrank strong exact
// matches. Never globally re-sort after round-robin: it undoes the diversity.
export const offerMerchantKey = offer => JSON.stringify([offer.provider, offer.provider === "shopify" ? offer.providerMarket || offer.merchant || "unknown" : offer.merchant || offer.providerMarket || "unknown"]);
const relevanceTier = offer => offer.exactMatch ? 3 : (offer.matchConfidence || 0) >= .65 ? 2 : (offer.matchConfidence || 0) > 0 ? 1 : 0;
export function compareOffers(a,b) {
  // Rank for shopper value: relevance first, then price. Geography is metadata,
  // not a hard ordering rule; a better global/GCC offer must be allowed to win.
  const relevanceDelta = (b.matchConfidence || 0) - (a.matchConfidence || 0);
  if (Math.abs(relevanceDelta) >= 0.12) return relevanceDelta;
  const priceDelta =
    (Number.isFinite(a.productPrice) ? a.productPrice : Infinity) -
    (Number.isFinite(b.productPrice) ? b.productPrice : Infinity);
  return relevanceDelta || priceDelta;
}
export function selectDiverseOffers(offers = [], limit = 120) {
  const cap = limit === Infinity ? Infinity : (Number.isFinite(limit) ? Math.max(0,Math.floor(limit)) : 120);
  if (!cap) return [];
  const sorted = [...offers].sort(compareOffers), selected=[];
  for (const tier of [3,2,1,0]) {
    const tierOffers=sorted.filter(offer => relevanceTier(offer)===tier);
    let cursor=0;
    while(cursor<tierOffers.length && selected.length<cap){
      // A score gap >=0.12 is material in compareOffers. Diversify only
      // among comparable confidence, never across materially weaker results.
      const highest=Number(tierOffers[cursor].matchConfidence || 0);
      const cohort=[];
      while(cursor<tierOffers.length &&
            Number(tierOffers[cursor].matchConfidence || 0)>highest-0.12){
        cohort.push(tierOffers[cursor++]);
      }
      const merchants=new Map();
      for(const offer of cohort){
        const id=offerMerchantKey(offer);
        if(!merchants.has(id))merchants.set(id,[]);
        merchants.get(id).push(offer);
      }
      let index=0,added=true;
      while(added && selected.length<cap){
        added=false;
        for(const bucket of merchants.values()){
          if(index<bucket.length){selected.push(bucket[index]);added=true;}
          if(selected.length>=cap)break;
        }
        index++;
      }
    }
    if(selected.length>=cap)break;
  }
  return selected;
}
