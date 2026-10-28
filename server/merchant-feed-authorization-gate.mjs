// NAWAA v22.06 — authorization-first, zero-network partner feed validation.
// Research-only evaluator. No feeds, contracts or credentials are installed.
// No merchant prices/offers, grants, cookies, URLs or user identifiers in output.
import {createHash,timingSafeEqual} from "node:crypto";

// An official affiliate programme in another country never constitutes
// authorization for the Saudi merchant. This registry is denial by default.
export const PARTNER_SOURCE_ACCESS=Object.freeze({
  "decathlon-sa":Object.freeze({
    sourceId:"decathlon-sa",merchantHost:"decathlon.com.sa",
    merchantCountry:"SA",dataFeedPermission:"UNVERIFIED",
    operatorVerifiedGrantInstalled:false,feedEnabled:false,
    customerOfferPromotionEnabled:false,
  }),
});

const MAX_BYTES=512_000,MAX_PRODUCTS=50,MAX_AGE_MS=60*60*1000;
const safeText=(s,max=128)=>typeof s==="string"&&s.trim()===s&&s.length>0&&s.length<=max;
const deny=status=>Object.freeze({
  status,authorizationVerified:false,
  feedIntegrityVerified:false,feedProductsAccepted:0,
  feedProductsRejected:0,selectedVariantIdentityValid:false,
  sourcePriceCurrencyVerified:false,stockVerified:false,
  shippingVerified:false,checkoutVerified:false,
  sourceCurrentPriceGuaranteed:false,
  trustedOffersCreated:0,publishedToSearch:false,
  customerVisible:false,quoteAllowed:false,
});
const report=(status,accepted,rejected)=>Object.freeze({
  ...deny(status),
  authorizationVerified:true,feedIntegrityVerified:true,
  feedProductsAccepted:accepted,feedProductsRejected:rejected,
  selectedVariantIdentityValid:accepted>0,
  sourcePriceCurrencyVerified:accepted>0,
});

function isOwnedProductUrl(raw,host){
  try{
    const u=new URL(raw);
    return u.protocol==="https:"&&u.hostname===host&&
      !u.username&&!u.password&&(!u.port||u.port==="443")&&
      !u.search&&!u.hash&&/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname);
  }catch{return false;}
}
function exactlyEqualsSha256(expected,actual){
  if(!/^[0-9a-f]{64}$/i.test(expected||""))return false;
  const a=Buffer.from(expected.toLowerCase(),"hex"),b=Buffer.from(actual,"hex");
  return timingSafeEqual(a,b);
}
function validTime(input,nowMs){
  if(typeof input!=="string"||!/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(input))
    return false;
  const ts=Date.parse(input);
  return Number.isFinite(ts)&&ts>0&&ts<=nowMs&&nowMs-ts<=MAX_AGE_MS;
}
function validateRow(row,merchantHost){
  if(!row||typeof row!=="object"||Array.isArray(row))return false;
  if(!safeText(row.sku,80)||!safeText(row.variantId,80)||
     !/^[a-z0-9_.-]+$/i.test(row.sku)||!/^\d{1,20}$/.test(row.variantId)||
     !isOwnedProductUrl(row.productUrl,merchantHost))return false;
  if(!Number.isSafeInteger(row.priceMinor)||row.priceMinor<=0||
     row.priceMinor>1_000_000_000||row.currency!=="SAR")return false;
  // An observed availability boolean is NOT verified inventory.
  if(row.available!==null&&typeof row.available!=="boolean")return false;
  return true;
}

/**
 * TrustedGrant MUST come from privileged, independently verified source
 * administration, not the feed, caller's query string or user-supplied data.
 * A grant alone does not establish permission; humans must verify original
 * agreement and scope before installing a digest-bound receipt.
 * This function does not fetch a feed or make an offer customer-visible.
 *
 * @param {object} options
 * @param {object|null} options.trustedGrant Verified by source owner ops.
 * @param {string} options.body Source-supplied JSON as received.
 * @param {number} options.nowMs Injected time for test determinism.
 */
export function assessAuthorizedMerchantFeed({
  sourceId="decathlon-sa",trustedGrant=null,body,nowMs=Date.now(),
}={}){
  const entry=PARTNER_SOURCE_ACCESS[sourceId];
  if(!entry)return deny("SOURCE_NOT_IN_REGISTRY");
  if(!trustedGrant||trustedGrant.sourceId!==sourceId||
     trustedGrant.verificationStatus!=="INDEPENDENTLY_VERIFIED"||
     trustedGrant.feedTransport!=="MERCHANT_SUPPLIED_FILE"||
     !safeText(trustedGrant.evidenceReference,160)||
     !Array.isArray(trustedGrant.permittedPurposes)||
     !["product_discovery","price_comparison"].every(p=>trustedGrant.permittedPurposes.includes(p))||
     trustedGrant.country!==entry.merchantCountry||
     trustedGrant.merchantHost!==entry.merchantHost)
    return deny("MERCHANT_AUTHORIZATION_REQUIRED");

  // Access grants expire in the future; the date must not be fabricated,
  // malformed, expired or an implausible indefinite authorization.
  if(!Number.isFinite(nowMs)||nowMs<=0||
     typeof trustedGrant.validUntil!=="string"||
     !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(trustedGrant.validUntil))
    return deny("MERCHANT_AUTHORIZATION_EXPIRED");
  const grantExpiry=Date.parse(trustedGrant.validUntil);
  if(!Number.isFinite(grantExpiry)||grantExpiry<=nowMs||
     grantExpiry-nowMs>366*24*60*60*1000)
    return deny("MERCHANT_AUTHORIZATION_EXPIRED");

  if(typeof body!=="string"||Buffer.byteLength(body,"utf8")>MAX_BYTES||!body.trim())
    return deny("FEED_PAYLOAD_INVALID");
  const actual=createHash("sha256").update(body,"utf8").digest("hex");
  if(!exactlyEqualsSha256(trustedGrant.approvedPayloadSha256,actual))
    return deny("FEED_INTEGRITY_NOT_VERIFIED");

  let data;
  try{data=JSON.parse(body);}catch{return deny("FEED_JSON_INVALID");}
  if(!data||typeof data!=="object"||Array.isArray(data)||
     data.schemaVersion!==1||data.sourceId!==sourceId||
     data.country!=="SA"||data.currency!=="SAR"||
     !validTime(data.observedAt,nowMs)||
     !Array.isArray(data.products)||data.products.length<1||
     data.products.length>MAX_PRODUCTS)
    return deny("FEED_STRUCTURE_OR_FRESHNESS_INVALID");
  const seen=new Set();let accepted=0,rejected=0;
  for(const row of data.products){
    if(!validateRow(row,entry.merchantHost)){rejected++;continue;}
    const key=row.productUrl+"|"+row.variantId;
    if(seen.has(key)){rejected++;continue;}
    seen.add(key);accepted++;
  }
  return report(accepted>0?"FEED_ROWS_SCOPED_FOR_RESEARCH":"FEED_HAS_NO_VALID_ROWS",accepted,rejected);
}
