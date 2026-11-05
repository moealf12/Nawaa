// R04 P0: decide whether already-acquired merchant evidence is discoverable.
// This is NOT an exact-product or price-trust certification. That remains the
// responsibility of assessOfferMatch, grouping and the client sold-subject
// taxonomy. Never use merchant, SEO URL or price to rescue a weak offer.
import {normalizeSearchQuery,parseSearchIntent,filterQueryOffers,queryMatchReasons,createOfferMatchAssessor} from "../src/search-query.mjs";

const STOP=new Set(["for","with","and","the","from","compatible","replacement",
  "new","used","original","model","in","on","of","a","an","to","by",
  "مع","من","في","على","مناسب","الجديد"]);

const terms=value=>normalizeSearchQuery(value||"").split(" ")
  .filter(term=>term.length>1&&!STOP.has(term));

// Construct once per query; repeated merchant offers reuse the normalized
// query terms. A weak score requires title-only lexical evidence from at
// least two meaningful query tokens (or the single token of a broad query).
// All legitimate lower-confidence titles remain below verified exact matches
// because offer-selection applies relevance tiers before price/diversity.
export function createSearchOfferAdmission(query,{legacyFloor=0.35}={}){
  const qt=[...new Set(terms(query))];
  const minimum=qt.length===1?1:2;
  return offer=>{
    const score=offer?.matchConfidence;
    if(typeof score!=="number"||!Number.isFinite(score)||score<0||score>1)return false;
    if(score>=legacyFloor)return true;
    if(qt.length===0)return false;
    const title=String(offer?.title||"");
    if(!title.trim())return false;
    const tt=new Set(terms(title));
    let hits=0;
    for(const token of qt){
      if(tt.has(token) && ++hits>=minimum)return true;
    }
    return false;
  };
}

// Keep source-owned transport evidence unchanged. Only the central server may
// certify exactMatch from an assessed product; the raw provider still returns
// exactMatch:false, even for an otherwise verified full device.
// Search cards filtered out for an EXPLICIT model may include safe accessories
// for the same model. Retain those as related, but never admit conflicting
// models/capacities. Broad category queries keep the original strict boundary
// (e.g. "perfume" must not publish a standalone empty atomizer).
export function retainAcquiredStorefrontOffers(query,offers=[]){
  const strict=filterQueryOffers(query,offers);
  const intent=parseSearchIntent(query);
  if(!intent.model)return {...strict,queryFilter:{...strict.queryFilter,relatedRetained:0}};
  const accepted=new Set(strict.offers);
  const assess=createOfferMatchAssessor(query);
  const admit=createSearchOfferAdmission(query);
  let relatedRetained=0;
  const retained=[];
  for(const original of offers){
    if(accepted.has(original)){
      retained.push(original);
      continue;
    }
    if(!original || typeof original!=="object")continue;
    // Exact conflicts are not "alternative price observations" for the
    // requested product. They stay excluded rather than consuming its page.
    const reasons=queryMatchReasons(query,original);
    if(reasons.includes("model_conflict")||reasons.includes("capacity_conflict"))
      continue;
    const candidate={...original,...assess(original)};
    if(!admit(candidate))continue;
    // Preserve the old source-to-server contract; only downstream recomputes
    // exactness. The candidate is transient evidence for the admission decision.
    retained.push(original);
    relatedRetained++;
  }
  return {offers:retained,queryFilter:{
    input:offers.length,retained:retained.length,
    removed:offers.length-retained.length,relatedRetained,
  }};
}
