// NAWAA R04-P50: observe the ACTUAL customer presentation pipeline.
// This is read-only, deterministic and contains no title, query, SKU, price,
// merchant, URL or raw customer data. No ranking/identity/condition changes.
import {buildDiscoverySections} from "../src/search-core.mjs";
import {buildSearchPresentationSections} from "../src/search-result-presentation.mjs";

const KNOWN_CONDITIONS=new Set(["new","used","refurbished","open_box"]);
const validCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000;

export function auditPresentationStages(query,groups,sections=null){
  if(typeof query!=="string"||!Array.isArray(groups)||
      groups.length>1000||!groups.every(g=>g&&typeof g==="object"))
    throw Error("R04_P50_INVALID_EVIDENCE_INPUT");
  // If supplied, this is the exact already computed customer presentation,
  // not a second, independently reimplemented condition/category classifier.
  const actual=sections??buildSearchPresentationSections(query,groups);
  const direct=actual?.classified?.primaryGroups;
  const exact=actual?.exactGroups;
  const unplaced=actual?.unplacedDirect;
  if(!Array.isArray(direct)||!Array.isArray(exact)||!Array.isArray(unplaced))
    throw Error("R04_P50_INVALID_PRESENTATION");
  const desired=actual.intent?.condition||"new";
  const targetKnown=KNOWN_CONDITIONS.has(desired);
  const rawAllowed=[],unknown=[],mismatched=[];
  let unrecognizedConditionCodes=0;
  for(const group of direct){
    const condition=group.bestOffer?.condition;
    if(condition===desired)rawAllowed.push(group);
    else if(!KNOWN_CONDITIONS.has(condition)){
      unknown.push(group);
      if(condition!==null&&condition!==undefined&&condition!=="")
        unrecognizedConditionCodes++;
    }else mismatched.push(group);
  }
  // Replay ONLY the pure discovery allocation used by production, with the
  // exact same pre-filtered direct group references.
  const initialDiscovery=buildDiscoverySections(query,rawAllowed)
    .flatMap(section=>section.groups);
  const initialSet=new Set(initialDiscovery);
  const actualSet=new Set(exact),directSet=new Set(direct);
  const unplacedSet=new Set(unplaced);
  const matchedSet=new Set(rawAllowed);
  const unknownSet=new Set(unknown),mismatchSet=new Set(mismatched);
  const rescued=rawAllowed.filter(g=>!initialSet.has(g)&&actualSet.has(g));
  const conditionMatchedUnplaced=rawAllowed.filter(g=>!actualSet.has(g));
  const counts={
    input:groups.length,
    classifierDirect:direct.length,
    classifierRelated:groups.length-direct.length,
    conditionMatched:rawAllowed.length,
    conditionUnknown:unknown.length,
    conditionUnrecognizedCodes:unrecognizedConditionCodes,
    conditionExplicitMismatch:mismatched.length,
    initialDiscoveryPlaced:initialSet.size,
    rescuedByExactTitleEvidence:rescued.length,
    conditionMatchedButUnplaced:conditionMatchedUnplaced.length,
    finalPrincipal:exact.length,
    finalRelated:actual.relatedGroups?.length??null,
    unplacedDirect:unplaced.length,
    unplacedUnknownCondition:unplaced.filter(g=>unknownSet.has(g)).length,
    unplacedExplicitMismatch:unplaced.filter(g=>mismatchSet.has(g)).length,
    unplacedMatchedCondition:unplaced.filter(g=>matchedSet.has(g)).length,
  };
  const uniqueGroups=groups.length===new Set(groups).size;
  const valid=targetKnown&&uniqueGroups&&Object.values(counts).every(validCount)&&
    actual.partitionedGroups===groups.length&&
    actual.classified.partitionedGroups===groups.length&&
    direct.length===new Set(direct).size&&
    exact.length===actualSet.size&&
    unplaced.length===unplacedSet.size&&
    exact.every(g=>directSet.has(g)&&matchedSet.has(g))&&
    unplaced.every(g=>directSet.has(g)&&!actualSet.has(g))&&
    direct.every(g=>actualSet.has(g)!==unplacedSet.has(g))&&
    counts.classifierDirect===
      counts.conditionMatched+counts.conditionUnknown+counts.conditionExplicitMismatch&&
    counts.conditionUnrecognizedCodes<=counts.conditionUnknown&&
    counts.conditionMatched===
      counts.initialDiscoveryPlaced+counts.rescuedByExactTitleEvidence+
      counts.conditionMatchedButUnplaced&&
    counts.classifierDirect===counts.finalPrincipal+counts.unplacedDirect&&
    counts.unplacedDirect===counts.unplacedUnknownCondition+
      counts.unplacedExplicitMismatch+counts.unplacedMatchedCondition&&
    counts.input===counts.finalPrincipal+counts.finalRelated;
  if(!valid)throw Error("R04_P50_PRESENTATION_CONSERVATION_FAILED");
  return {
    schemaVersion:"nawaa.r04.p50.presentation-stage.v1",
    classifier:"EXACT_CUSTOMER_PRESENTATION_WITH_PURE_DISCOVERY_REPLAY",
    requestedCondition:actual.intent?.condition?"explicit":"default_new",
    conditionUnknownMeans:"NOT_PROVEN_NEW",
    ...counts,
    safety:"OBSERVATION_ONLY_NO_PRODUCT_PROMOTION",
    nextProbe:counts.unplacedUnknownCondition>0?
      "VERIFY_SOURCE_CONDITION_PROVENANCE":
      counts.unplacedExplicitMismatch>0?
      "VERIFY_REQUESTED_VS_OFFER_CONDITION":
      counts.classifierDirect===0?"TRACE_LIVE_SOURCE_EXACT_MATCH_EVIDENCE":
      counts.conditionMatchedButUnplaced>0?
      "TRACE_DISCOVERY_CATEGORY_AND_DISPUTE_ADMISSION":
      "NO_DIRECT_PRESENTATION_LOSS_OBSERVED",
  };
}
