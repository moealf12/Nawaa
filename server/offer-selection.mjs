// Balance merchants within relevance tiers, then preserve normal match/price ordering.
export const offerMerchantKey = offer => JSON.stringify([offer.provider, offer.provider === "shopify" ? offer.providerMarket || offer.merchant || "unknown" : offer.merchant || offer.providerMarket || "unknown"]);
const relevanceTier = offer => offer.exactMatch ? 3 : (offer.matchConfidence || 0) >= .65 ? 2 : (offer.matchConfidence || 0) > 0 ? 1 : 0;
export function compareOffers(a,b) {
  return (b.matchConfidence || 0) - (a.matchConfidence || 0) ||
    (Number.isFinite(a.productPrice) ? a.productPrice : Infinity) - (Number.isFinite(b.productPrice) ? b.productPrice : Infinity);
}
export function selectDiverseOffers(offers = [], limit = 120) {
  const cap = Number.isFinite(limit) ? Math.max(0,Math.floor(limit)) : 120;
  const sorted = [...offers].sort(compareOffers), selected=[];
  for (const tier of [3,2,1,0]) {
    const merchants=new Map();
    for(const offer of sorted) {
      if(relevanceTier(offer)!==tier)continue;
      const id=offerMerchantKey(offer);
      if(!merchants.has(id))merchants.set(id,[]);
      merchants.get(id).push(offer);
    }
    let index=0,added=true;
    while(added && selected.length<cap) {
      added=false;
      for(const bucket of merchants.values()) {
        if(index<bucket.length) {selected.push(bucket[index]);added=true;}
        if(selected.length>=cap)break;
      }
      index++;
    }
    if(selected.length>=cap)break;
  }
  return selected.sort(compareOffers);
}
