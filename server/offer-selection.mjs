import {filterAmazonDeUnattestedCustomerOffers} from "../src/amazon-de-price-gate.mjs";
// Keep the shopper's first results diversified across independently identified
// merchants, without allowing weak matches or accessories to outrank strong exact
// matches. Never globally re-sort after round-robin: it undoes the diversity.
export const offerMerchantKey = offer => JSON.stringify([offer.provider, offer.provider === "shopify" ? offer.providerMarket || offer.merchant || "unknown" : offer.merchant || offer.providerMarket || "unknown"]);
const confidence = offer => Number.isFinite(Number(offer?.matchConfidence)) ? Number(offer.matchConfidence) : 0;
const relevanceTier = offer => offer.exactMatch ? 3 : confidence(offer) >= .65 ? 2 : confidence(offer) > 0 ? 1 : 0;
export function compareOffers(a,b) {
  // A material identity-confidence gap always wins; within one relevance
  // cohort and currency, compare positive observed prices before tiny score
  // differences. Unconverted USD/EUR/SAR numbers are never comparable.
  const relevanceDelta = confidence(b) - confidence(a);
  if (Math.abs(relevanceDelta) >= 0.12) return relevanceDelta;
  const sameTier = relevanceTier(a) === relevanceTier(b);
  const sameCurrency = typeof a?.currency === "string" &&
    /^[A-Z]{3}$/.test(a.currency) && a.currency === b?.currency;
  if (sameTier && sameCurrency && a.exactMatch === b.exactMatch) {
    const price = offer =>
      typeof offer?.productPrice === "number" &&
      Number.isFinite(offer.productPrice) && offer.productPrice > 0
        ? offer.productPrice : Infinity;
    const pa=price(a),pb=price(b);
    if (pa !== pb) return pa < pb ? -1 : 1;
  }
  return relevanceDelta;
}
export function selectDiverseOffers(offers = [], limit = 120) {
  const cap = limit === Infinity ? Infinity : (Number.isFinite(limit) ? Math.max(0,Math.floor(limit)) : 120);
  if (!cap) return [];
  const sorted = filterAmazonDeUnattestedCustomerOffers(offers).sort((a,b)=>confidence(b)-confidence(a)), selected=[];
  for (const tier of [3,2,1,0]) {
    const tierOffers=sorted.filter(offer => relevanceTier(offer)===tier);
    let cursor=0;
    while(cursor<tierOffers.length && selected.length<cap){
      // A score gap >=0.12 is material in compareOffers. Diversify only
      // among comparable confidence, never across materially weaker results.
      const highest=confidence(tierOffers[cursor]);
      const cohort=[];
      while(cursor<tierOffers.length &&
            confidence(tierOffers[cursor])>highest-0.12){
        cohort.push(tierOffers[cursor++]);
      }
      const merchants=new Map();
      for(const offer of cohort){
        const id=offerMerchantKey(offer);
        if(!merchants.has(id))merchants.set(id,[]);
        merchants.get(id).push(offer);
      }
      // Keep cohort boundaries anchored to confidence, then sort only each
      // merchant's comparable offers by buyer price. Do not globally re-sort:
      // round-robin merchant diversity must remain intact.
      for (const bucket of merchants.values()) bucket.sort(compareOffers);
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
