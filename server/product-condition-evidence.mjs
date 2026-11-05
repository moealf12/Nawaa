import {normalizeCondition} from "./provider-utils.mjs";

// Only a Product and its SINGLE, already-identity-checked selected priced
// Offer may attest condition. Never scan other Product/Offer nodes in the page.
const declared=value=>value!==undefined&&value!==null&&value!=="";

/**
 * Source-owned condition evidence for an identity-qualified Product/Offer.
 * No title inference, store-wide defaults or ambiguous variant assumptions.
 */
export function resolveAssociatedItemCondition(product,selectedOffer){
  const productRaw=product?.itemCondition;
  const offerRaw=selectedOffer?.raw?.itemCondition;
  const hasProduct=declared(productRaw);
  const hasOffer=declared(offerRaw);
  const fromProduct=hasProduct?normalizeCondition(productRaw):"unknown";
  const fromOffer=hasOffer?normalizeCondition(offerRaw):"unknown";
  if(hasProduct&&hasOffer){
    if(fromProduct==="unknown"||fromOffer==="unknown"||fromProduct!==fromOffer)
      return {condition:"unknown",evidence:"CONFLICTING_OR_UNVERIFIED"};
    return {condition:fromProduct,evidence:"PRODUCT_AND_SELECTED_OFFER"};
  }
  if(hasProduct)return {condition:fromProduct,
    evidence:fromProduct==="unknown"?"UNVERIFIED":"PRODUCT"};
  if(hasOffer)return {condition:fromOffer,
    evidence:fromOffer==="unknown"?"UNVERIFIED":"SELECTED_PRICED_OFFER"};
  return {condition:"unknown",evidence:"ABSENT"};
}
