// Safe write-through of one observed eXtra Python price to an EXISTING UNBXD offer.
// Preserves original catalog URL/canonical ID, price provenance, and trust rules.
import {approvedExtraPdp,approvedExtraIndexUrl,runExtraPythonPdp} from "../src/python-extra-bridge.mjs";
import {sameOfferIdentity,compareProductIdentity} from "./product-identity.mjs";
import {queryMatchReasons,normalizeSearchQuery} from "../src/search-query.mjs";

const SHA=/^[a-f0-9]{64}$/;
const PRICE=/^\d{1,9}(?:\.\d{1,2})?$/;
const SOURCE="extra-sa";
const TRACE=new Set(["JSON-LD","DOM"]);
const isObject=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const fieldSource=(e,key)=>e?.field_evidence?.[key]?.source;
const clean=s=>normalizeSearchQuery(String(s||"")).replace(/\s+/g," ").trim();
const numberAsText=x=>typeof x==="string" ? x.trim() : "";

// Explicit model variants may not be cross-filled even with matching SKU;
// indexer records can hold a stale/recycled SKU or a mislabeled title.
function explicitModel(value){
  const v=String(value||"").toLowerCase();
  const match=v.match(/\biphone[\s-]*(\d{1,2})(?:\s*(pro\s*max|pro|plus|air|mini|e))?\b/);
  if(match)return "iphone"+match[1]+(match[2]||"").replace(/\s+/g,"");
  const galaxy=v.match(/\bgalaxy\s*s(\d{2})(?:\s*(ultra|plus|fe))?\b/);
  if(galaxy)return "galaxys"+galaxy[1]+(galaxy[2]||"");
  const console=v.match(/\bps5\s*(pro|slim|digital|disc)?\b/);
  return console?"ps5"+(console[1]||""):null;
}
function capacity(value){
  const m=String(value||"").toLowerCase().match(/\b(\d{2,4})\s*(gb|tb)\b/);
  return m ? Number(m[1])*(m[2]==="tb"?1024:1) : null;
}
function noExplicitVariantConflict(existing,evidence){
  const title=String(evidence.product_title||"");
  const fromTitle=explicitModel(existing.title);
  const observedTitle=explicitModel(title);
  if(fromTitle&&(!observedTitle||observedTitle!==fromTitle))return false;
  const oldCapacity=capacity(existing.specs?.storage)||capacity(existing.title);
  const newCapacity=capacity(title);
  if(oldCapacity&&(!newCapacity||newCapacity!==oldCapacity))return false;
  const brand=existing.specs?.brand;
  if(brand&&(!evidence.brand||clean(brand)!==clean(evidence.brand)))return false;
  const color=clean(existing.specs?.color);
  if(color&&!clean(title).includes(color))return false;
  return true;
}

export function admitExtraPythonObservation(existing,evidence,matchingQuery,{pdpUrl}={}){
  if(!isObject(existing)||!isObject(evidence)||
    existing.provider!=="extra-unbxd"||existing.providerMarket!==SOURCE||
    existing.merchant!=="eXtra"||existing.currency!=="SAR"||
    existing.originalCurrency!=="SAR")
    return {accepted:false,reason:"SOURCE_OWNER_MISMATCH"};
  const sku=String(existing.sourceMeta?.productId||"");
  if(!approvedExtraIndexUrl(existing.sourceUrl,sku)||
    !approvedExtraPdp(pdpUrl,sku))
    return {accepted:false,reason:"PDP_INDEX_URL_SKU_MISMATCH"};
  if(evidence.sku!==sku||evidence.requested_url!==pdpUrl||
    evidence.final_url!==pdpUrl)
    return {accepted:false,reason:"PRODUCT_SOURCE_URL_SKU_MISMATCH"};
  if(!SHA.test(String(evidence.response_sha256||"")))
    return {accepted:false,reason:"RESPONSE_HASH_MISSING"};
  if(!Array.isArray(evidence.issues)||evidence.issues.length!==0||
    typeof evidence.product_title!=="string"||evidence.product_title.trim().length<8)
    return {accepted:false,reason:"PRODUCT_EVIDENCE_INCOMPLETE"};
  if(!PRICE.test(numberAsText(evidence.price))||
    !(Number(evidence.price)>0)||evidence.currency!=="SAR")
    return {accepted:false,reason:"PRICE_CURRENCY_INVALID"};
  const source=fieldSource(evidence,"price");
  if(!TRACE.has(source)||source!==fieldSource(evidence,"currency"))
    return {accepted:false,reason:"PRICE_PROVENANCE_INCOMPLETE"};
  if(fieldSource(evidence,"sku")!=="JSON-LD")
    return {accepted:false,reason:"SKU_NOT_STRUCTURED_DATA"};
  if(evidence.availability!=="UNKNOWN" &&
    !TRACE.has(fieldSource(evidence,"availability")))
    return {accepted:false,reason:"STOCK_PROVENANCE_UNATTESTED"};

  const time=Date.parse(evidence.fetched_at);
  if(!Number.isFinite(time)||time>Date.now()+60_000||time<Date.now()-5*60_000)
    return {accepted:false,reason:"EVIDENCE_STALE_OR_UNTIMED"};
  if(!noExplicitVariantConflict(existing,evidence))
    return {accepted:false,reason:"MODEL_STORAGE_BRAND_COLOR_CONFLICT"};

  const observed={...existing,sourceUrl:pdpUrl,resolvedPageUrl:pdpUrl,
    title:evidence.product_title,brand:evidence.brand,sku,
    specs:{...existing.specs,brand:evidence.brand}};
  const anchored={...existing,sku};
  if(!sameOfferIdentity(anchored,observed)||
    compareProductIdentity(anchored,observed).conflicts.some(
      key=>["sku","gtin","model","brand"].includes(key)
    )||queryMatchReasons(matchingQuery,observed).length)
    return {accepted:false,reason:"VARIANT_OR_QUERY_CONFLICT"};
  const updatedPrice=Number(evidence.price);
  const indexPrice=Number(existing.productPrice);
  // A radically inconsistent price needs manual review, not an automatic
  // replacement. This is a guardrail, not an inferred promotional price.
  if(!Number.isFinite(indexPrice)||indexPrice<=0||
    updatedPrice<indexPrice*0.5||updatedPrice>indexPrice*2)
    return {accepted:false,reason:"PRICE_DELTA_REVIEW_REQUIRED"};

  const stamped=new Date(time).toISOString();
  const updated={
    ...existing,
    productPrice:updatedPrice,
    originalProductPrice:updatedPrice,
    currency:"SAR",originalCurrency:"SAR",
    observedAt:stamped,
    // Never take "IN_STOCK" from a page to mean city stock or delivery is
    // assured. Preserve UNBXD's existing city/availability assertions.
    exactMatch:false,matchConfidence:0,priceConfidence:"incomplete",
    sourceMeta:{
      ...existing.sourceMeta,
      indexPrice:existing.productPrice,
      priceSource:"extra-python-pdp",
      priceObservedAt:stamped,
      pythonPdpEvidence:{
        sourceId:SOURCE,sku,sha256:evidence.response_sha256,
        parser:evidence.parser_version,
        priceFieldSource:source,currencyFieldSource:fieldSource(evidence,"currency"),
        stockFieldSource:fieldSource(evidence,"availability")||null,
        sourceAvailability:evidence.availability
      }
    }
  };
  return {accepted:true,reason:"EXACT_SKU_SOURCE_PRICE_ADMITTED",offer:updated};
}

// A retry, denial, timeout, unavailable Python runtime or contradictory PDP
// NEVER causes a second eXtra offer or a loss of the existing index offer.
export async function enrichExtraOffersWithPython(offers,matchingQuery,{
  approvedSku,approvedUrl,signal,timeoutMs=3000,extract=runExtraPythonPdp
}={}){
  const originals=Array.isArray(offers)?offers:[];
  const next=originals.slice();
  const diagnostics={attempted:0,accepted:0,rejected:0,failed:0,
    transport:"bounded-python-jsonl",failureClasses:[]};
  if(!approvedExtraPdp(approvedUrl,approvedSku))
    return {offers:next,diagnostics};
  const seen=new Set();
  for(let index=0;index<originals.length;index++){
    if(signal?.aborted)break;
    const candidate=originals[index];
    if(candidate?.provider!=="extra-unbxd"||candidate.merchant!=="eXtra"||
      String(candidate.sourceMeta?.productId||"")!==approvedSku||
      !approvedExtraIndexUrl(candidate.sourceUrl,approvedSku))continue;
    if(seen.has(candidate.sourceUrl))continue;
    seen.add(candidate.sourceUrl);
    // One candidate, one bounded Python fetch, no source-wide loop.
    if(diagnostics.attempted)break;
    diagnostics.attempted++;
    try{
      const evidence=await extract(
        {url:approvedUrl,expectedSku:approvedSku},{timeoutMs,signal}
      );
      const decision=admitExtraPythonObservation(
        candidate,evidence,matchingQuery,{pdpUrl:approvedUrl}
      );
      if(decision.accepted){
        next[index]=decision.offer;
        diagnostics.accepted++;
      }else{
        diagnostics.rejected++;
        diagnostics.failureClasses.push(decision.reason);
      }
    }catch(error){
      diagnostics.failed++;
      const msg=String(error?.message||"");
      diagnostics.failureClasses.push(
        /^PYTHON_EXTRA_[A-Z0-9_]{3,100}$/.test(msg)?msg:"PYTHON_EXTRA_FAILURE"
      );
    }
  }
  return {offers:next,diagnostics};
}
