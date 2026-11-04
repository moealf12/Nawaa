// NAWAA-owned proposed ingestion contract for a Noon-approved marketplace feed.
// Not a documented Noon API response schema. Diagnostic-only; never customer-facing.
import {noonSaudiProductIdentity} from "./noon-sa-catalog.mjs";

export const NOON_APPROVED_FEED_SCHEMA="nawaa.noon-sa.approved-feed.v1";
const OFFER_CODE=/^[a-z0-9-]{1,100}$/i;
const MAX_PRODUCTS=5000;
const MAX_AGE_MS=60*60*1000;
const MAX_FUTURE_SKEW_MS=5*60*1000;
const FRESH_WINDOW_MS=10*60*1000;
const MAX_TITLE_LENGTH=350;
const MAX_PRICE=10_000_000;

function timestamp(raw) {
  if(typeof raw!=="string"||raw.length<20||raw.length>40||
    !/T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))return null;
  const parsed=Date.parse(raw);
  return Number.isFinite(parsed)?parsed:null;
}
function price(raw){
  if(typeof raw!=="number"||!Number.isFinite(raw)||raw<=0||raw>MAX_PRICE)return null;
  if(Math.abs(raw*100-Math.round(raw*100))>1e-6)return null;
  return raw;
}
function safeNoonImage(raw){
  if(typeof raw!=="string"||raw.length>2048)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=="https:"||url.username||url.password||url.port)return null;
    if(url.hostname.toLowerCase()!=="f.nooncdn.com" &&
       !url.hostname.toLowerCase().endsWith(".nooncdn.com"))return null;
    return url.href;
  }catch{return null}
}
function sameOfferUrl(raw,expectedCode){
  if(typeof raw!=="string"||raw.length>2048||!OFFER_CODE.test(expectedCode))return null;
  const id=noonSaudiProductIdentity(raw);
  if(!id)return null;
  try{
    const url=new URL(raw);
    if(url.searchParams.getAll("o").length!==1||
      url.searchParams.get("o")!==expectedCode||
      [...url.searchParams.keys()].length!==1||url.hash)return null;
    return {
      sku:id.sku,
      offerUrl:id.canonicalUrl+"?o="+encodeURIComponent(expectedCode),
      productUrl:id.canonicalUrl,
    };
  }catch{return null}
}
function normalized(record,now){
  if(!record||typeof record!=="object"||Array.isArray(record))return {error:"NOT_OBJECT"};
  const sku=typeof record.sku==="string"?record.sku.toUpperCase():"";
  const code=record.offer_code;
  const u=sameOfferUrl(record.product_url,code);
  if(!u||u.sku!==sku)return {error:"SKU_OFFER_IDENTITY_INVALID"};
  if(typeof record.title!=="string"||record.title.trim().length<4||
     record.title.trim().length>MAX_TITLE_LENGTH)return {error:"TITLE_INVALID"};
  if(record.currency!=="SAR")return {error:"CURRENCY_NOT_SAR"};
  const value=price(record.price);
  if(value===null)return {error:"PRICE_INVALID"};
  const observed=timestamp(record.observed_at);
  if(observed===null||observed>now+MAX_FUTURE_SKEW_MS)return {error:"OBSERVED_TIME_INVALID"};
  const image=safeNoonImage(record.image_url);
  return {
    key:sku+"|"+code,
    sku,offerCode:code,
    title:record.title.trim(),
    offerUrl:u.offerUrl,
    productUrl:u.productUrl,
    image,
    price:value,
    currency:"SAR",
    observedAt:new Date(observed).toISOString(),
    observedMs:observed,
    source:"noon-sa",
    market:"SA",
    priceEvidence:"AUTHORIZED_FEED_UNVERIFIED_PDP",
    pdpVerified:false,
    checkoutVerified:false,
    deliveryVerified:false,
    customerPublishable:false,
  };
}

// The declared marketplace scope must be independently verified with Noon.
// Conflicting prices/titles for the same exact SKU+offer code are discarded.
export function inspectNoonApprovedFeedPage(payload,{now=Date.now()}={}){
  const invalid=(reason)=>({state:reason,records:[],accepted:0,rejected:0,
    conflicts:0,freshOffers:0,declaredMarketplaceWide:false,customerPublishable:false});
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
    return invalid("INVALID_FEED");
  if(payload.schema!==NOON_APPROVED_FEED_SCHEMA)return invalid("SCHEMA_MISMATCH");
  if(payload.market!=="SA")return invalid("NON_SAUDI_MARKET");
  if(payload.scope!=="marketplace")return invalid("UNSUITABLE_PARTNER_ONLY_SCOPE");
  const generated=timestamp(payload.generated_at);
  if(generated===null||generated>now+MAX_FUTURE_SKEW_MS||
     now-generated>MAX_AGE_MS)return invalid("FEED_GENERATION_STALE_OR_INVALID");
  if(!Array.isArray(payload.records)||payload.records.length>MAX_PRODUCTS)
    return invalid("RECORD_COUNT_INVALID");

  const byIdentity=new Map();
  let rejected=0,conflicts=0;
  const rejectedReasons=Object.create(null);
  const reject=(reason)=>{
    rejected++;
    rejectedReasons[reason]=(rejectedReasons[reason]||0)+1;
  };
  for(const record of payload.records){
    const parsed=normalized(record,now);
    if(parsed.error){reject(parsed.error);continue}
    const previous=byIdentity.get(parsed.key);
    if(previous===null)continue;
    if(previous){
      if(previous.price!==parsed.price || previous.title!==parsed.title ||
         previous.productUrl!==parsed.productUrl){
        byIdentity.set(parsed.key,null);
        conflicts++;
      }else if(parsed.observedMs>previous.observedMs) {
        byIdentity.set(parsed.key,parsed);
      }
      continue;
    }
    byIdentity.set(parsed.key,parsed);
  }
  const records=[...byIdentity.values()].filter(Boolean);
  const freshOffers=records.filter(x=>now>=x.observedMs &&
    now-x.observedMs<=FRESH_WINDOW_MS).length;
  return {
    state:records.length?"APPROVED_FEED_PAGE_VALIDATED_DIAGNOSTIC_ONLY":
      "NO_VALID_RECORDS",
    records,accepted:records.length,rejected,conflicts,rejectedReasons,
    freshOffers,
    generatedAt:new Date(generated).toISOString(),
    declaredMarketplaceWide:true,scopeIndependentlyVerified:false,
    customerPublishable:false,
  };
}
