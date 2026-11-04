// R04-P47: audit-only reason histogram from the ACTUAL production classifier.
// No product/title/price/query/URL/error text leaves the analysis function.
import {classifyResultGroup} from "../src/search-result-intelligence.mjs";
const REASONS=new Set([
  "missing_offer","insufficient_subject_evidence",
  "separate_game_for_console","separately_sold_documentation",
  "separately_sold_part_or_accessory","title_evidenced_match",
  "related_subject_unverified_variant","document_not_primary",
  "related_part_or_accessory",
]);
const LANES=new Set(["direct","alternative","accessory","game","guide","other"]);
const ROLES=new Set(["product","accessory","guide","unknown"]);
export function summarizeGroupClassificationEvidence(query,groups,{maxGroups=1000}={}){
  if(!Array.isArray(groups)||typeof query!=="string")throw Error("INVALID_CLASSIFIER_EVIDENCE_INPUT");
  if(!Number.isInteger(maxGroups)||maxGroups<1||maxGroups>1000)
    throw Error("INVALID_CLASSIFIER_EVIDENCE_LIMIT");
  const seen=groups.slice(0,maxGroups),reasons={},lanes={},roles={};
  const coverageBins={zero:0,low:0,medium:0,high:0,unknown:0};
  let sourceExact=0,modelVerified=0,highMatchConfidence=0,invalidDecisions=0;
  for(const group of seen){
    let decision;
    try{decision=classifyResultGroup(query,group);}
    catch{invalidDecisions++;continue;}
    const lane=LANES.has(decision?.lane)?decision.lane:"unknown";
    const reason=REASONS.has(decision?.reason)?decision.reason:"unknown";
    const role=ROLES.has(decision?.role)?decision.role:"unknown";
    lanes[lane]=(lanes[lane]||0)+1;
    reasons[reason]=(reasons[reason]||0)+1;
    roles[role]=(roles[role]||0)+1;
    if(decision?.sourceExact===true)sourceExact++;
    if(decision?.modelVerified===true)modelVerified++;
    const offer=group?.bestOffer??group?.offers?.[0];
    if(offer?.exactMatch===true&&Number(offer.matchConfidence)>=.9)
      highMatchConfidence++;
    const coverage=decision?.coverage;
    const bin=typeof coverage!=="number"||!Number.isFinite(coverage)||coverage<0||coverage>1?
      "unknown":coverage===0?"zero":coverage<.33?"low":coverage<.67?"medium":"high";
    coverageBins[bin]++;
  }
  return {
    schemaVersion:"nawaa.r04.p47.classification-audit.v1",
    examinedGroups:seen.length,omittedGroups:groups.length-seen.length,
    invalidDecisions,reasonCounts:reasons,laneCounts:lanes,roleCounts:roles,
    sourceExact,modelVerified,highMatchConfidence,coverageBins,
    auditedWith:"ACTUAL_CUSTOMER_RESULT_CLASSIFIER",
    notProofOf:["human_relevance","stockout","merchant_exhaustiveness","ranking_quality"],
  };
}
