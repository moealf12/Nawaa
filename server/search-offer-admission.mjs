// R04 P0: decide whether already-acquired merchant evidence is discoverable.
// This is NOT an exact-product or price-trust certification. That remains the
// responsibility of assessOfferMatch, grouping and the client sold-subject
// taxonomy. Never use merchant, SEO URL or price to rescue a weak offer.
import {normalizeSearchQuery} from "../src/search-query.mjs";

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
    const score=Number(offer?.matchConfidence);
    if(!Number.isFinite(score)||score<0||score>1)return false;
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
