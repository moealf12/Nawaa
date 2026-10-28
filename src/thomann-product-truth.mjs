import {createHash} from "node:crypto";

// Exact ownership for Thomann's three distinct Superlux HD-662 retail SKUs.
// Unknown suffixes (BK/Evo/etc.) fail closed rather than becoming the base model.
const PATH=/^\/de\/superlux_hd662(?:_([fb]))?\.htm$/i;
const MODEL=/\bhd[\s_-]*662(?:[\s_-]*([fb]))?(?=$|[^a-z0-9])/i;
const FAMILY=/\bsuperlux\b/i;
const UNKNOWN_SUFFIX=/^\s*(?:bk|evo|pro|mk\s*\d+)\b/i;

function sameMerchantProductUrl(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=="https:"||url.hostname!=="www.thomann.de"||
      (url.port && url.port!=="443")||url.username||url.password)return null;
    const match=PATH.exec(url.pathname);
    return match ? {url,variant:match[1]?.toUpperCase()||"BASE"} : null;
  } catch{return null}
}

function titleModel(title) {
  const source=String(title||"").replace(/[_–—]/g," ").trim();
  if(!FAMILY.test(source))return null;
  const hits=[...source.matchAll(new RegExp(MODEL.source,"gi"))];
  if(hits.length!==1)return null;
  const hit=hits[0],next=source.slice(hit.index+hit[0].length);
  if(UNKNOWN_SUFFIX.test(next))return null;
  return hit[1]?.toUpperCase()||"BASE";
}

export function thomannVariantIdentity(title,rawUrl) {
  const path=sameMerchantProductUrl(rawUrl);
  const variant=titleModel(title);
  if(!path||!variant||variant!==path.variant)return null;
  const model="HD-662"+(variant==="BASE"?"":" "+variant);
  const identityKey="thomann.de|superlux|"+model.toLowerCase()+"|"+path.url.pathname.toLowerCase();
  return {
    brand:"Superlux",model,variant,
    productUrl:path.url.origin+path.url.pathname,
    identityHash:createHash("sha256").update(identityKey).digest("hex"),
  };
}

export function thomannQueryVariant(query) {
  const source=String(query||"").replace(/[_–—]/g," ").trim();
  if(!MODEL.test(source))return null;
  const match=MODEL.exec(source);
  const next=source.slice(match.index+match[0].length);
  if(UNKNOWN_SUFFIX.test(next))return "UNSUPPORTED";
  return match[1]?.toUpperCase()||"BASE";
}

// A broad search has no exact suffix restriction. An explicit HD-662 request
// must not return HD-662 F/B as the same saleable product.
export function thomannVariantMatchesQuery(query,title,url) {
  const expected=thomannQueryVariant(query);
  if(expected==="UNSUPPORTED")return false;
  const path=sameMerchantProductUrl(url);
  if(!path)return expected===null; // Explicit HD-662 requests cannot accept unrelated PDP paths.
  const identity=thomannVariantIdentity(title,url);
  return Boolean(identity) && (!expected||identity.variant===expected);
}

function cents(value) {
  const n=Number(value);
  return Number.isFinite(n) && n>0 ? Math.round(n*100) : null;
}

export function compareThomannSearchPdp(searchItem,pdpResult) {
  const search=thomannVariantIdentity(searchItem?.title,searchItem?.sourceUrl);
  const pdp=thomannVariantIdentity(pdpResult?.title,pdpResult?.sourceUrl);
  const searchCents=cents(searchItem?.price),pdpCents=cents(pdpResult?.originalProductPrice);
  let reason="PDP_PARITY_CONFIRMED";
  if(!search||!pdp||search.identityHash!==pdp.identityHash)reason="VARIANT_IDENTITY_CONFLICT";
  else if(searchItem?.currency!=="EUR"||pdpResult?.originalCurrency!=="EUR")reason="CURRENCY_CONFLICT";
  else if(searchCents===null||pdpCents===null)reason="PRICE_NOT_OBSERVED";
  else if(searchCents!==pdpCents)reason="SEARCH_PDP_PRICE_CONFLICT";
  return {
    matched:reason==="PDP_PARITY_CONFIRMED",reason,
    identityHash:reason==="PDP_PARITY_CONFIRMED"?search.identityHash:null,
  };
}

// Deliberately invoked once for a limited set of pre-priced search cards.
// The caller provides the existing DNS-checked PDP resolver, never arbitrary
// proxying or a second request following a merchant 403/429.
export async function verifyThomannSearchCards(items,{
  resolvePdp,limit=2,signal,
}={}){
  const accepted=[],diagnostics=[];
  const cap=Math.max(0,Math.min(2,Number.isInteger(limit)?limit:2));
  const seen=new Set();
  for(const item of Array.isArray(items)?items:[]){
    if(accepted.length>=cap||diagnostics.length>=cap||signal?.aborted)break;
    const identity=thomannVariantIdentity(item?.title,item?.sourceUrl);
    if(!identity){diagnostics.push({reason:"VARIANT_IDENTITY_CONFLICT"});continue}
    if(seen.has(identity.identityHash))continue;
    seen.add(identity.identityHash);
    if(typeof resolvePdp!=="function")throw Error("PDP_RESOLVER_REQUIRED");
    try{
      const pdp=await resolvePdp(item.sourceUrl);
      const parity=compareThomannSearchPdp(item,pdp);
      diagnostics.push({reason:parity.reason});
      if(parity.matched)accepted.push({...item,thomannIdentity:identity,
        shippingContext:pdp.shippingContext || null,
        pdpPriceEvidence:"SEARCH_PDP_PRICE_PARITY"});
    }catch(error){
      const status=Number(error?.status||String(error?.message||"").match(/\b(?:HTTP|returned)\s+(\d{3})\b/i)?.[1]);
      const blocked=status===403||status===429;
      diagnostics.push({reason:blocked?"PDP_ACCESS_DENIED":"PDP_RESOLUTION_FAILED"});
      if(blocked)break;
    }
  }
  return {accepted,diagnostics};
}
