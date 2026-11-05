// Universal recall admission: the number of related merchant hits is not proof
// that a shopper can actually see a correct principal product.
// This is an observation-only planning signal. It NEVER promotes products,
// changes customer identity, price, variant, stock, condition, or seller truth.
import {parseSearchIntent,normalizeSearchQuery} from "../src/search-query.mjs";
import {groupComparableOffers} from "../src/search-core.mjs";
import {buildSearchPresentationSections} from "../src/search-result-presentation.mjs";
import {acquisitionPlan} from "./search-cursor.mjs";

const MAX_VERIFIED_PROBE=128;

export function inspectFirstPassRecall(query,offers=[],{
  merchantKey=offer=>offer?.merchant||"",
}={}){
  if(typeof query!=="string"||!Array.isArray(offers)||
     typeof merchantKey!=="function")
    throw TypeError("INVALID_RECALL_INSPECTION");
  const normalized=normalizeSearchQuery(query);
  if(!normalized)return {
    needsExpansion:false,strictPrincipalObserved:0,weakRelatedCount:0,
    relevantMerchants:0,broadDiscovery:false,reason:"EMPTY_QUERY",
  };
  const intent=parseSearchIntent(normalized);
  const requestedCondition=intent.condition||"new";
  const broad=intent.discoveryMode==="brand"||
    (!intent.model&&!intent.storage&&!intent.color&&!intent.condition);
  const usefulThreshold=broad?20:6;
  let weakRelatedCount=0;
  const merchantSet=new Set();
  const strong=[];
  let verifiedCandidateTotal=0;
  for(const offer of offers){
    const confidence=offer?.matchConfidence;
    if(Number.isFinite(confidence)&&confidence>=0.65){
      weakRelatedCount++;
      const merchant=merchantKey(offer);
      if(typeof merchant==="string"&&merchant)merchantSet.add(merchant);
    }
    if(offer?.exactMatch===true&&Number.isFinite(confidence)&&
       confidence>=0.9&&offer.condition===requestedCondition){
      verifiedCandidateTotal++;
      if(strong.length<MAX_VERIFIED_PROBE)strong.push(offer);
    }
  }
  // Invoke EXACTLY the browser's grouping/classifier/condition/discovery
  // admission. Inspection is capped to protect free-tier CPU at 1000+ offers.
  // Truncation can cause an extra source probe, never an unsafe promotion.
  const groups=strong.length?groupComparableOffers(strong,"lowest"):[];
  const strictPrincipalObserved=groups.length?
    buildSearchPresentationSections(normalized,groups).exactGroups.length:0;
  const insufficientRelated=weakRelatedCount<usefulThreshold;
  const insufficientMerchants=broad&&merchantSet.size<2&&weakRelatedCount<40;
  const principalAbsent=strictPrincipalObserved===0;
  const needsExpansion=principalAbsent||insufficientRelated||insufficientMerchants;
  return {
    needsExpansion,strictPrincipalObserved,
    verifiedCandidateTotal,strictProbeTruncated:verifiedCandidateTotal>MAX_VERIFIED_PROBE,
    weakRelatedCount,relevantMerchants:merchantSet.size,broadDiscovery:broad,
    reason:principalAbsent?"NO_VERIFIED_PRESENTABLE_PRINCIPAL":
      insufficientRelated?"INSUFFICIENT_RELATED_RECALL":
      insufficientMerchants?"INSUFFICIENT_MERCHANT_DIVERSITY":
      "FIRST_WAVE_SUFFICIENT",
  };
}

// When all generic lexical relaxations are empty, we must not repeat the
// same query against the same providers. Advance to a DISJOINT, bounded
// storefront window in the existing registry using the SAME original query
// for final exactness. This works for unrecognized brands and product types.
export function planOpenWorldStorefrontBackfill(query,storefrontCount,{
  firstWaveStorefrontLimit=null,
}={}){
  if(!normalizeSearchQuery(query))return null;
  const first=acquisitionPlan(0,storefrontCount);
  const next=acquisitionPlan(1,storefrontCount);
  // Honor the first wave's actual window, and never replay the same source.
  if(firstWaveStorefrontLimit!==null&&
     firstWaveStorefrontLimit!==first.storefrontLimit)return null;
  if(next.storefrontLimit<1)return null;
  return {
    storeOffset:next.storefrontOffset,
    storeLimit:Math.min(6,next.storefrontLimit),
    productPageLimit:2,storeDeadlineMs:3500,
    catalogLimit:Infinity,
    sourceEvidence:"OPEN_WORLD_DISJOINT_STOREFRONTS",
  };
}
