// NAWAA v22.03 — isolated quote-readiness rehearsal, NOT an endpoint.
// Two separately acquired PDP observations can establish same SKU and price,
// but cannot establish inventory, deliverability, checkout or current quote.
// Fail closed; never emit source data, SKU, variant IDs or monetary amounts.
import {attestDecathlonVariantPrice} from "./decathlon-variant-price-ownership.mjs";
import {extractDecathlonScopedIdentity} from "./decathlon-product-evidence.mjs";
import {extractShopifyVariantState} from "./shopify-page-variant.mjs";

const MAX_OBSERVATION_AGE_MS=30_000;
const HOST="decathlon.com.sa";
const path=raw=>{
  try{
    const u=new URL(raw);
    if(u.protocol!=="https:"||u.hostname!==HOST||u.username||u.password||
      u.search||u.hash||(u.port&&u.port!=="443")||
      !/^\/products\/[a-z0-9][a-z0-9-]*\/?$/i.test(u.pathname))return null;
    return u.pathname.replace(/\/+$/,"");
  }catch{return null;}
};
const decision=(status,extra={})=>Object.freeze({
  status,
  quoteAllowed:false,checkoutAllowed:false,customerOfferEligible:false,
  storePriceFreshnessCertified:false,inventoryVerified:false,
  shippingVerified:false,inventoryClaim:"unknown",
  sameSelectedVariant:false,samePriceBetweenObservations:false,
  revalidationWasIndependent:false,
  ...extra,
});

function getOwnedSnapshot(raw,nowMs){
  if(!raw||typeof raw!=="object")return null;
  const target=path(raw.url),redirect=path(raw.finalUrl);
  if(!target||!redirect||target!==redirect)return {status:"SOURCE_IDENTITY_MISMATCH"};
  if(!Number.isFinite(raw.receivedAtMs)||raw.receivedAtMs<=0||
     !Number.isFinite(nowMs)||nowMs<raw.receivedAtMs||
     nowMs-raw.receivedAtMs>MAX_OBSERVATION_AGE_MS)
    return {status:"SOURCE_OBSERVATION_EXPIRED_OR_INVALID"};
  if(raw.httpStatus!==200)return {status:"QUOTE_SOURCE_UNAVAILABLE"};
  if(typeof raw.html!=="string"||raw.html.length===0)
    return {status:"QUOTE_PRICE_OWNERSHIP_UNVERIFIED"};
  // Source ownership of the chosen variant is mandatory. Page-wide Meta
  // amount and a ProductGroup lowPrice cannot supply the required price.
  const attestation=attestDecathlonVariantPrice(raw.html,raw.finalUrl);
  if(!attestation.variantPriceOwned)
    return {status:"QUOTE_PRICE_OWNERSHIP_UNVERIFIED"};
  const identity=extractDecathlonScopedIdentity(raw.html,raw.finalUrl);
  if(identity.status!=="SCOPED_IDENTITY_OBSERVED")
    return {status:"QUOTE_PRICE_OWNERSHIP_UNVERIFIED"};
  const variantUrl=new URL(raw.finalUrl);
  variantUrl.searchParams.set("variant",identity.selectedVariant);
  const product=extractShopifyVariantState(raw.html,variantUrl.href);
  const offer=product?.offers;
  if(!product?.shopifyVariantEvidence||!offer||
     offer.priceCurrency!=="SAR"||!Number.isFinite(offer.price)||offer.price<=0||
     String(offer.sku)!==String(identity.sku))
    return {status:"QUOTE_PRICE_OWNERSHIP_UNVERIFIED"};
  // These values are used only inside this function and never serialized to
  // return value, logs, callbacks, analytics or customer paths.
  return {status:"OWNED_SOURCE_OBSERVATION",sku:identity.sku,
    variantId:identity.selectedVariant,
    price:offer.price,
    productPath:target,at:raw.receivedAtMs,
    requestId:raw.requestId};
}

export function evaluateDecathlonQuoteReadiness({search,quote,nowMs=Date.now()}={}){
  if(!quote)return decision("QUOTE_SOURCE_REVALIDATION_REQUIRED");
  if(!search)return decision("QUOTE_SOURCE_REVALIDATION_REQUIRED");
  // Rechecking the *same snapshot* does not revalidate a customer quote.
  if(typeof search.requestId!=="string"||!search.requestId.trim()||
     typeof quote.requestId!=="string"||!quote.requestId.trim()||
     search.requestId===quote.requestId||
     !Number.isFinite(search.receivedAtMs)||
     !Number.isFinite(quote.receivedAtMs)||
     search.receivedAtMs>=quote.receivedAtMs)
    return decision("QUOTE_SOURCE_REVALIDATION_REQUIRED");
  const first=getOwnedSnapshot(search,nowMs);
  if(first?.status==="SOURCE_IDENTITY_MISMATCH")return decision("SOURCE_IDENTITY_MISMATCH");
  if(first?.status==="SOURCE_OBSERVATION_EXPIRED_OR_INVALID")
    return decision("SOURCE_OBSERVATION_EXPIRED_OR_INVALID");
  if(first?.status!=="OWNED_SOURCE_OBSERVATION")
    return decision("SEARCH_PRICE_OWNERSHIP_UNVERIFIED");
  const second=getOwnedSnapshot(quote,nowMs);
  if(second?.status!=="OWNED_SOURCE_OBSERVATION")
    return decision(second?.status||"QUOTE_SOURCE_UNAVAILABLE");
  if(first.productPath!==second.productPath||
     first.sku!==second.sku||first.variantId!==second.variantId)
    return decision("SELECTED_PRODUCT_CHANGED");
  if(first.price!==second.price)
    return decision("PRICE_CHANGED_REQUOTE_REQUIRED",{
      sameSelectedVariant:true,revalidationWasIndependent:true,
    });
  // Two stable source-priced pages still cannot establish stock, checkout,
  // shipping costs, delivery time, availability now, or a binding seller quote.
  return decision("STOCK_AND_DELIVERY_UNVERIFIED",{
    sameSelectedVariant:true,samePriceBetweenObservations:true,
    revalidationWasIndependent:true,
  });
}
