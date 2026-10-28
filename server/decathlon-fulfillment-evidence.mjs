// NAWAA v22.04 — source-only availability diagnostics for one selected SKU.
// This deliberately does NOT certify inventory, Saudi delivery, shipping fees,
// availability at checkout, or permission to issue a binding quote.
// There are NO new requests or merchant endpoints here.
import {extractDecathlonScopedIdentity} from "./decathlon-product-evidence.mjs";
import {attestDecathlonVariantPrice} from "./decathlon-variant-price-ownership.mjs";
import {inspectShopifySelectedVariantAvailability} from "./shopify-page-variant.mjs";

const reject=(status,merchantAvailableSignal=null,signalSource=null,selectedVariantMatched=false)=>
  Object.freeze({
    status,selectedVariantMatched,merchantAvailableSignal,signalSource,
    stockClaim:"unknown",
    inventoryVerified:false,shippingVerified:false,
    shippingPriceVerified:false,deliveryDestinationVerified:false,
    checkoutVerified:false,quoteAllowed:false,trustedOfferEligible:false,
    customerVisible:false,sourceFreshnessCertified:false,
  });

/**
 * Optional destination metadata cannot substitute for independent delivery
 * terms. No shipping provider, checkout or quote action is contacted.
 */
export function evaluateDecathlonFulfillmentReadiness(
  html,requestedUrl,{destinationCountry="SA"}={}
){
  if(typeof html!=="string"||!html.trim()||html.length>1_500_000)
    return reject("SOURCE_DOCUMENT_UNUSABLE");
  const identity=extractDecathlonScopedIdentity(html,requestedUrl);
  if(identity.status!=="SCOPED_IDENTITY_OBSERVED")
    return reject("SELECTED_PRODUCT_IDENTITY_UNVERIFIED");
  const owned=attestDecathlonVariantPrice(html,requestedUrl);
  if(owned.variantPriceOwned!==true)
    return reject("SELECTED_VARIANT_PRICE_UNVERIFIED");
  const chosen=new URL(requestedUrl);
  chosen.searchParams.set("variant",identity.selectedVariant);
  const stock=inspectShopifySelectedVariantAvailability(
    html,chosen.href,identity.sku
  );
  if(!stock.selectedVariantMatched)
    return reject("SELECTED_VARIANT_RECORD_UNVERIFIED");
  if(stock.status==="VARIANT_AVAILABILITY_CONFLICT")
    return reject("VARIANT_AVAILABILITY_CONFLICT",null,null,true);
  if(stock.status==="SELECTED_VARIANT_AVAILABILITY_UNKNOWN")
    return reject("NO_VARIANT_AVAILABILITY_EVIDENCE",null,null,true);
  if(stock.status==="SELECTED_VARIANT_UNAVAILABLE_SIGNAL")
    return reject("VARIANT_UNAVAILABLE_SOURCE_SIGNAL",false,stock.sourceSignal,true);
  if(stock.status==="SELECTED_VARIANT_AVAILABLE_SIGNAL")
    return reject("VARIANT_AVAILABILITY_OBSERVED_DELIVERY_UNVERIFIED",true,stock.sourceSignal,true);
  return reject("SELECTED_VARIANT_AVAILABILITY_UNKNOWN");
}
