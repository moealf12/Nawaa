import {createHash} from "node:crypto";

// BIKE24's pNNNNNNN is an offer-specific retailer PDP, not a Garmin model.
// Keep catalog identity separate from product family, edition, and maker MPN.
export function bike24PdpId(raw){
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.hostname!=="www.bike24.com"||
       (u.port&&u.port!=="443")||u.username||u.password)return null;
    const m=/^\/p(\d{5,11})\.html$/i.exec(u.pathname);
    return m?m[1]:null;
  }catch{return null}
}
const cleaned=value=>String(value||"").toLowerCase().normalize("NFKC")
  .replace(/[®™]/g,"").replace(/\s+/g," ").trim();
export function bike24GarminEdition(title){
  const name=cleaned(title);
  // Require a Garmin Edge 540 product name, not accessories compatible
  // with 540, Edge 540 Solar bundles, or unrelated Edge generations.
  if(!/^garmin edge 540\b/i.test(name))return null;
  if(/\b(?:case|cover|mount|cable|replacement|spare part)\b/.test(name))return null;
  const solar=/\bsolar\b/.test(name);
  const bundle=/\b(?:bundle|sensor set|hrm set)\b/.test(name);
  return solar&&bundle?"SOLAR_BUNDLE":solar?"SOLAR":bundle?"BUNDLE":"STANDARD";
}
export function bike24Identity({title,sourceUrl,mpn=null,gtin=null}={}){
  const id=bike24PdpId(sourceUrl),edition=bike24GarminEdition(title);
  if(!id||!edition)return null;
  const productKey="bike24|garmin|edge-540|"+edition.toLowerCase()+"|p"+id;
  return {
    retailerProductId:id,brand:"Garmin",model:"Edge 540",edition,
    identityHash:createHash("sha256").update(productKey).digest("hex"),
    mpn:mpn||null,gtin:gtin||null,
  };
}
export function bike24QueryEdition(query){
  const name=cleaned(query);
  if(!/\bgarmin\b.*\bedge\s*540\b/.test(name))return null;
  if(/\b(?:case|cover|mount|cable|replacement)\b/.test(name))return "ACCESSORY";
  return /\bsolar\b/.test(name)
    ? (/\bbundle\b/.test(name)?"SOLAR_BUNDLE":"SOLAR")
    : (/\bbundle\b/.test(name)?"BUNDLE":"STANDARD");
}
export function bike24MatchesQuery(query,offer){
  const desired=bike24QueryEdition(query);
  if(!desired)return true;
  if(desired==="ACCESSORY")return false;
  const identity=bike24Identity(offer);
  return Boolean(identity)&&identity.edition===desired;
}
const cents=value=>{
  const num=Number(value);
  return Number.isFinite(num)&&num>0?Math.round(num*100):null;
};
const manufacturerCode=value=>String(value||"").toUpperCase().replace(/\s+/g,"").trim();
export function compareBike24SearchPdp(search,pdp){
  const a=bike24Identity(search),b=bike24Identity(pdp);
  let reason="SEARCH_PDP_PRICE_PARITY";
  if(!a||!b||a.identityHash!==b.identityHash)reason="VARIANT_IDENTITY_CONFLICT";
  else if(search.currency!=="EUR"||pdp.originalCurrency!=="EUR")reason="CURRENCY_CONFLICT";
  else if(a.mpn&&b.mpn&&manufacturerCode(a.mpn)!==manufacturerCode(b.mpn))reason="MPN_CONFLICT";
  else if(a.gtin&&b.gtin&&a.gtin!==b.gtin)reason="GTIN_CONFLICT";
  else if(cents(search.price)===null||cents(pdp.originalProductPrice)===null)reason="PRICE_NOT_OBSERVED";
  else if(cents(search.price)!==cents(pdp.originalProductPrice))reason="SEARCH_PDP_PRICE_CONFLICT";
  return {matched:reason==="SEARCH_PDP_PRICE_PARITY",reason,
    identityHash:reason==="SEARCH_PDP_PRICE_PARITY"?a?.identityHash:null};
}
// Only already priced search cards trigger a bounded additional PDP request.
// Never reroute after 403/429; never promote a card with mismatched price.
// This also does not attest merchant shipping eligibility or checkout total.
export async function verifyBike24SearchCards(cards,{resolvePdp,limit=2,signal}={}){
  if(typeof resolvePdp!=="function")throw Error("PDP_RESOLVER_REQUIRED");
  const accepted=[],diagnostics=[],seen=new Set();
  for(const card of Array.isArray(cards)?cards:[]){
    if(diagnostics.length>=Math.max(0,Math.min(2,limit))||signal?.aborted)break;
    const identity=bike24Identity(card);
    if(!identity){diagnostics.push({reason:"IDENTITY_MISSING"});continue;}
    if(seen.has(identity.identityHash))continue;
    seen.add(identity.identityHash);
    try{
      const pdp=await resolvePdp(card.sourceUrl);
      const result=compareBike24SearchPdp(card,pdp);
      diagnostics.push({reason:result.reason});
      if(result.matched)accepted.push({...card,identityHash:identity.identityHash,
        bike24Identity:identity,pdpPriceEvidence:result.reason});
    }catch(e){
      const code=Number(e?.status||String(e?.message||"").match(/\b(?:HTTP|returned)\s+(\d{3})\b/i)?.[1]);
      const denied=code===403||code===429;
      diagnostics.push({reason:denied?"PDP_ACCESS_DENIED":"PDP_RESOLUTION_FAILED"});
      if(denied)break;
    }
  }
  return {accepted,diagnostics};
}
