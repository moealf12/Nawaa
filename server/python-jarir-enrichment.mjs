// Strict admission boundary for Jarir price evidence extracted by Python.
// It can refine an ALREADY DISCOVERED Jarir offer, never create an unrelated
// one, grant VERIFIED, overwrite canonical ownership, or change product SKU.
import {runJarirPythonPdp,approvedJarirPdp} from "../src/python-jarir-bridge.mjs";
import {sameOfferIdentity} from "./product-identity.mjs";
import {queryMatchReasons} from "../src/search-query.mjs";

const SHA=/^[0-9a-f]{64}$/;
const DECIMAL=/^\d{1,9}(?:\.\d{1,2})?$/;
const SOURCE="jarir-sa";
const OWNED=new Set(["JSON-LD","Hydration"]);
const PROHIBITED_STATUS=new Set(["ERROR","UNKNOWN"]);
const isObj=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const sourceOf=(e,key)=>e?.field_evidence?.[key]?.source;
const matchesSeller=s=>s==="Jarir Bookstore"||s==="Jarir";

export function admitJarirPythonObservation(existing,evidence,matchingQuery){
  if(!isObj(existing)||!isObj(evidence)||existing.provider!=="jarir-direct"||
    existing.providerMarket!==SOURCE||existing.merchant!=="Jarir"||
    existing.currency!=="SAR")return {accepted:false,reason:"SOURCE_OWNER_MISMATCH"};
  const sku=String(existing.sourceMeta?.productId||"");
  const url=existing.sourceUrl;
  if(!approvedJarirPdp(url,sku))return {accepted:false,reason:"PDP_URL_SKU_UNVERIFIED"};
  if(evidence.sku!==sku||evidence.requested_url!==url||evidence.final_url!==url)
    return {accepted:false,reason:"PDP_IDENTITY_MISMATCH"};
  if(!SHA.test(String(evidence.response_sha256||"")))
    return {accepted:false,reason:"PDP_RESPONSE_HASH_MISSING"};
  if(!matchesSeller(evidence.seller)||evidence.offer_url!==url||
    sourceOf(evidence,"seller")!=="JSON-LD"||
    sourceOf(evidence,"offer_url")!=="JSON-LD")
    return {accepted:false,reason:"MERCHANT_OFFER_OWNERSHIP_MISSING"};
  if(!Array.isArray(evidence.issues)||evidence.issues.length!==0||
    typeof evidence.product_title!=="string"||evidence.product_title.trim().length<8)
    return {accepted:false,reason:"AMBIGUOUS_OR_MISSING_PRODUCT"};
  if(typeof evidence.price!=="string"||!DECIMAL.test(evidence.price)||
    !(Number(evidence.price)>0)||Number(evidence.price)>1e8||
    evidence.currency!=="SAR")
    return {accepted:false,reason:"PRICE_CURRENCY_NOT_ATTESTED"};
  if(!OWNED.has(sourceOf(evidence,"price"))||
    !OWNED.has(sourceOf(evidence,"currency"))||
    sourceOf(evidence,"price")!==sourceOf(evidence,"currency"))
    return {accepted:false,reason:"PRICE_FIELD_PROVENANCE_INVALID"};
  // No silent claim of sellable stock based on a generic page heading.
  if(evidence.availability!=="IN_STOCK"||
    !OWNED.has(sourceOf(evidence,"availability_raw")))
    return {accepted:false,reason:"SELLABLE_STOCK_UNATTESTED"};
  const time=Date.parse(evidence.fetched_at);
  if(!Number.isFinite(time)||time>Date.now()+60_000||
    time<Date.now()-5*60_000)
    return {accepted:false,reason:"OBSERVATION_STALE"};
  const price=Number(evidence.price);
  const candidateWithSku={...existing,sku,sourceUrl:url};
  const observedWithSku={...existing,sku,sourceUrl:url,resolvedPageUrl:url,
    title:evidence.product_title};
  if(!sameOfferIdentity(candidateWithSku,observedWithSku)||
    queryMatchReasons(matchingQuery,observedWithSku).length)
    return {accepted:false,reason:"VARIANT_OR_QUERY_CONFLICT"};
  const result={
    ...existing,
    productPrice:price,originalProductPrice:price,
    currency:"SAR",originalCurrency:"SAR",
    availability:"in_stock",
    observedAt:new Date(time).toISOString(),
    // Rank and trust labels must be independently computed by core Node.
    exactMatch:false,matchConfidence:0,priceConfidence:"incomplete",
    sourceMeta:{
      ...existing.sourceMeta,
      indexPrice:existing.productPrice,
      priceSource:"jarir-python-pdp-jsonld",
      priceObservedAt:new Date(time).toISOString(),
      pythonPdpEvidence:{
        sourceId:SOURCE,sku,sha256:evidence.response_sha256,
        seller:evidence.seller,fieldSource:sourceOf(evidence,"price")
      }
    }
  };
  return {accepted:true,offer:result,reason:"PDP_PRICE_OWNED"};
}

export async function enrichJarirOffersWithPython(offers,matchingQuery,{
  signal,maxCandidates=1,timeoutMs=5500,extract=runJarirPythonPdp,allowedSku=null
}={}){
  const originals=Array.isArray(offers)?offers:[];
  const next=originals.slice();
  const limit=Math.min(2,Math.max(0,Number.isInteger(maxCandidates)?maxCandidates:1));
  const diagnostics={attempted:0,accepted:0,rejected:0,failed:0,
    enabled:true,transport:"subprocess-jsonl",failureClasses:[]};
  // Only process discovered exact PDP URLs, not generic search endpoints.
  const used=new Set();
  for(let index=0;index<originals.length&&diagnostics.attempted<limit;index++){
    if(signal?.aborted)break;
    const candidate=originals[index],sku=String(candidate?.sourceMeta?.productId||"");
    if(allowedSku!==null && sku!==allowedSku)continue;
    if(candidate?.provider!=="jarir-direct"||candidate?.merchant!=="Jarir"||
      !approvedJarirPdp(candidate?.sourceUrl,sku))continue;
    const unique=JSON.stringify([candidate.sourceUrl,sku]);
    if(used.has(unique))continue;
    used.add(unique);
    diagnostics.attempted++;
    try{
      const evidence=await extract({url:candidate.sourceUrl,expectedSku:sku},{
        signal,timeoutMs
      });
      const decision=admitJarirPythonObservation(candidate,evidence,matchingQuery);
      if(decision.accepted){
        next[index]=decision.offer;
        diagnostics.accepted++;
      }else{
        diagnostics.rejected++;
        diagnostics.failureClasses.push(decision.reason);
      }
    }catch(error){
      diagnostics.failed++;
      // Never log raw URLs, merchant HTML, source body, request IDs or prices.
      diagnostics.failureClasses.push(
        /^PYTHON_JARIR_[A-Z_]+$/.test(String(error?.message||""))
          ? error.message : "PYTHON_JARIR_FAILURE"
      );
    }
  }
  return {offers:next,diagnostics};
}
