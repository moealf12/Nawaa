export function selectSearchStreamResult(latestSnapshot,latestWithOffers){
  if(!latestWithOffers)return latestSnapshot||null;
  if(!latestSnapshot)return latestWithOffers;
  return {...latestSnapshot,offers:latestWithOffers.offers};
}

const EXTRA_INDEX_URL=/^https:\/\/www\.extra\.com\/en-sa\/p\/(\d{5,12})$/;

export function needsExtraSourceRecovery(data){
  if(!Array.isArray(data?.offers)||data.offers.some(o=>o?.merchant==="eXtra"))return false;
  return Array.isArray(data?.errors)&&data.errors.some(e=>
    (e?.sourceId==="extra-unbxd"||e?.provider==="extra-unbxd")&&
    /timeout|aborted|abort|deadline/i.test(String(e?.error||""))
  );
}

// Recovery is a fresh, normal first-party customer API response, not a guessed
// merchant price or a scraper fallback. Preserve previous merchant offers,
// never copy unrelated JSON merchants, and never grant trust/verification flags.
export function mergeExtraSourceRecovery(original,refreshed){
  if(!needsExtraSourceRecovery(original)||!Array.isArray(refreshed?.offers))return original;
  const fresh=refreshed.offers.filter(o=>{
    if(o?.provider!=="extra-unbxd"||o?.providerMarket!=="extra-sa"||
      o?.merchant!=="eXtra"||o?.currency!=="SAR"||
      !Number.isFinite(Number(o.productPrice))||Number(o.productPrice)<=0)return false;
    const sku=String(o.sourceMeta?.productId||"");
    return EXTRA_INDEX_URL.exec(String(o.sourceUrl||""))?.[1]===sku;
  });
  if(!fresh.length)return original;
  const merged=[...original.offers],seen=new Set(merged.map(o=>o?.sourceUrl));
  for(const offer of fresh){
    if(!seen.has(offer.sourceUrl)){
      seen.add(offer.sourceUrl);
      merged.push(offer);
    }
  }
  const added=merged.length-original.offers.length;
  if(!added)return original;
  return {...original,offers:merged,
    recovery:{sourceId:"extra-unbxd",type:"fresh-json",addedOffers:added},
    coverage:{...original.coverage,returnedOffers:merged.length},
  };
}
