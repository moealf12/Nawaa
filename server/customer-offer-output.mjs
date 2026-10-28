// Shared final read-side safety policy for JSON and SSE responses. The
// source-acquisition gate alone cannot remove old indexed/cached offers.
import {filterAmazonDeUnattestedCustomerOffers} from "../src/amazon-de-price-gate.mjs";

export function enforceCustomerOfferPublication(result){
  if(!result || typeof result!=="object")return result;
  const incoming=Array.isArray(result.offers)?result.offers:[];
  const safe=filterAmazonDeUnattestedCustomerOffers(incoming);
  if(safe.length===incoming.length)return result;
  // Count only the offers genuinely eligible for a customer-facing response.
  const priorCoverage=result.coverage||{};
  return {
    ...result,offers:safe,
    coverage:{
      ...priorCoverage,
      returnedOffers:safe.length,
      availableOffers:safe.length,
      returnedMerchants:new Set(safe.map(x=>JSON.stringify([
        x?.provider||"",x?.merchant||x?.providerMarket||"",
      ]))).size,
    },
  };
}
