// Bounded result *window* for a single acquisition wave. Keep the first HTTP
// payload small while allowing 1,000 verified, ranked merchant offers to be
// retrieved through the existing signed within-wave cursor.
// This counts only offers from available sources; it cannot certify worldwide
// coverage, or guarantee 1,000 products for a sparse query.
import {selectDiverseOffers} from "./offer-selection.mjs";

export const SEARCH_WAVE_RESULT_LIMIT=1_000;

export function prepareSearchResultWindow(offers,{returnLimit,resultLimit=SEARCH_WAVE_RESULT_LIMIT}={}){
  if(!Array.isArray(offers) || !Number.isSafeInteger(returnLimit) || returnLimit<1 ||
      !Number.isSafeInteger(resultLimit)||resultLimit<returnLimit||resultLimit>SEARCH_WAVE_RESULT_LIMIT)
    throw new TypeError("invalid_search_result_window");
  // Select once. The selector removes held/unattested price evidence and keeps
  // exact/product-identity tiers and merchant diversity ahead of cheap accessories.
  const ranked=selectDiverseOffers(offers,Infinity);
  const allSelectedOffers=ranked.slice(0,resultLimit);
  const selectedOffers=allSelectedOffers.slice(0,returnLimit);
  return {
    allSelectedOffers,selectedOffers,
    rankedCandidates:ranked.length,
    resultLimit,
    resultLimitReached:ranked.length>allSelectedOffers.length,
  };
}
