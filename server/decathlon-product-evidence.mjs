// Experimental, source-bound Decathlon identity evidence.
// Zero offers, prices, stock, delivery or customer-visible authority.
// No network calls. Never use alone to certify a current sellable offer.
import { load } from "cheerio";
import { extractionCandidates } from "./url-resolver.mjs";
const HOST="decathlon.com.sa";
const normal=s=>String(s||"").normalize("NFKC").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu," ").replace(/\s+/g," ").trim();
const pagePath=(raw)=>{
  try{const u=new URL(raw);return u.protocol==="https:"&&u.hostname===HOST&&
    !u.username&&!u.password&&(!u.port||u.port==="443")&&!u.hash&&
    (!u.search || [...u.searchParams.keys()].every(k=>k==="variant"))&&
    /^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname)
    ?u.pathname.replace(/\/+$/,""):null;}
  catch{return null;}
};
const onlyOne=values=>{const clean=values.map(x=>String(x||"").trim()).filter(Boolean);const set=new Set(clean);return clean.length&&set.size===1?clean[0]:null;};
const meta=($,key)=>String($('meta[property="'+key+'"]').first().attr("content")||"").trim();
const EMPTY=(reason)=>({status:reason,identityProven:false,priceProven:false,inventoryProven:false});
const safeImage=(url,base)=>{
  if(typeof url!=="string"||!url.trim()||url.length>2000)return null;
  try{
    const u=new URL(url.trim(),base);
    // Page URL itself, non-image protocols and dangerous credentials are not images.
    if(u.href===new URL(base).href || u.protocol!=="https:"||
       u.username||u.password||(u.port&&u.port!=="443")||
       !/\.(?:jpe?g|png|webp|avif)(?:$|[?#])/i.test(u.href))
      return null;
    return u.href;
  }catch{return null;}
};
export function extractDecathlonScopedIdentity(html,requestedUrl){
  const expected=pagePath(requestedUrl);
  if(!expected)return EMPTY("INVALID_SOURCE_URL");
  const $=load(String(html||"").slice(0,1_500_000));
  const canon=$('link[rel="canonical"]').first().attr("href");
  let canonicalPath=null;
  try{if(canon)canonicalPath=pagePath(new URL(canon,requestedUrl).href);}catch{}
  if(canonicalPath!==expected)return EMPTY("CANONICAL_OWNERSHIP_NOT_VERIFIED");
  const title=meta($,"og:title")||$("title").first().text().trim();
  if(!title)return EMPTY("MISSING_PAGE_TITLE");
  // Reuse NAWAA's existing bounded Schema.org graph resolver. Shopify
  // emits ProductGroup/graph references as well as individual Products; a
  // second ad-hoc JSON-LD parser can miss legitimate page-level evidence.
  const graph=extractionCandidates(String(html||"").slice(0,1_500_000),requestedUrl)
    .find(entry=>entry.strategy==="jsonld")?.product||null;
  if(!graph?.name||normal(graph.name)!==normal(title))
    return EMPTY("SCHEMA_SUBJECT_NOT_UNIQUE");
  const product=graph;
  // JSON-LD attributes may describe a family. Never import its Offer or
  // a guessed variant price; only compare current subject identity.
  const product=exactlyOwned[0];
  if(product.url){
    try{if(pagePath(new URL(product.url,requestedUrl).href)!==expected)
      return EMPTY("SCHEMA_URL_CONFLICT");}
    catch{return EMPTY("SCHEMA_URL_CONFLICT");}
  }
  const scope=$("main").first();
  if(!scope.length)return EMPTY("NO_PRODUCT_SCOPE");
  const skus=scope.find("[data-sku]").toArray().map(el=>$(el).attr("data-sku"));
  const variants=scope.find('form[action*="/cart/add"] input[name="id"]')
    .toArray().map(el=>$(el).attr("value"));
  const sku=onlyOne(skus),selectedVariant=onlyOne(variants);
  if(!sku||!/^[a-z0-9_.-]{1,80}$/i.test(sku))return EMPTY("SKU_AMBIGUOUS");
  if(!selectedVariant||!/^\d{1,20}$/.test(selectedVariant))
    return EMPTY("VARIANT_AMBIGUOUS");
  const url=new URL(requestedUrl);
  const requestedVariant=url.searchParams.get("variant");
  if(requestedVariant&&requestedVariant!==selectedVariant)
    return EMPTY("VARIANT_URL_CONFLICT");
  const image=safeImage(meta($,"og:image"),requestedUrl);
  if(!image)return EMPTY("IMAGE_EVIDENCE_MISSING");
  const named=meta($,"og:title");
  if(named&&normal(named)!==normal(exactlyOwned[0].name))
    return EMPTY("META_TITLE_CONFLICT");
  // Identity only, no product sale offer or price fields exposed from this
  // extractor. Integration with search must require independent price binding.
  return {status:"SCOPED_IDENTITY_OBSERVED",identityProven:true,
    title,sku,selectedVariant,image,productUrl:requestedUrl,
    provenance:{canonical:true,jsonldTitle:true,scopedForm:true,uniqueSku:true},
    priceProven:false,inventoryProven:false};
}
