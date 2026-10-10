// Deterministic repair queue; describes safe diagnostic actions, not ways to
// circumvent merchant blocks or enable unverified sources.
const ACTIONS=Object.freeze({
 missing_evidence:{
  tier:"P0",action:"Inspect missing/truncated CI report and rerun a bounded authorized check"},
 merchant_access_blocked:{
  tier:"P0",action:"Stop repeated automated probes; review merchant terms and permitted official API/feed access"},
 routing_not_verified:{
  tier:"P1",action:"Inspect query routing and registry identity with offline fixtures"},
 missing_product_images:{
  tier:"P1",action:"Verify source-supported image extraction and HTTPS URL validation using permitted data"},
 offer_or_price_validation:{
  tier:"P1",action:"Check SKU/variant, SAR conversion and price fields with source-backed fixture tests"},
 transport_or_timeout:{
  tier:"P1",action:"Inspect bounded timeout/retry logs, reduce request load, review sanctioned endpoint availability"},
 transient_merchant_http_error:{
  tier:"P1",action:"Respect Retry-After and bounded backoff on upstream 502/503/504; never certify a failed check"},
 oversized_merchant_response:{
  tier:"P1",action:"Inspect safe pagination and permitted compact endpoints; retain byte ceilings and reject oversized responses"},
 no_valid_product_candidates:{
  tier:"P2",action:"Inspect allowed search response schema/selector drift using saved fixtures"},
 other_certification_failure:{
  tier:"P2",action:"Inspect per-case certification evidence before selecting a remediation"},
 certification_passed:{
  tier:"VERIFIED",action:"Maintain routine independent price/image cross-checks; no broad rollout"}
});
const TIER_ORDER={P0:0,P1:1,P2:2,VERIFIED:3};
export function prioritizeCertificationFailures(diagnostic,{maxItems=39}={}){
 if(!diagnostic||diagnostic.mode!=="offline_certification_diagnostic"||
    !Array.isArray(diagnostic.rows))
  throw new Error("invalid_certification_diagnostic");
 if(!Number.isInteger(maxItems)||maxItems<1||maxItems>100)
  throw new Error("invalid_triage_limit");
 const list=diagnostic.rows.filter(row=>row.evidenceStatus!=="certified")
  .map(row=>{
   const details=ACTIONS[row.diagnosis]||ACTIONS.other_certification_failure;
   return {
    sourceId:row.sourceId,status:row.evidenceStatus,category:row.diagnosis,
    severity:details.tier,positiveQueriesPassed:row.positiveQueriesPassed,
    validOfferCandidates:row.validOfferCandidates,action:details.action
   };
  });
 list.sort((a,b)=>TIER_ORDER[a.severity]-TIER_ORDER[b.severity]||
  b.positiveQueriesPassed-a.positiveQueriesPassed||
  a.sourceId.localeCompare(b.sourceId));
 const counts={P0:0,P1:0,P2:0};
 for(const row of list)counts[row.severity]++;
 return {mode:"non_authorizing_remediation_queue",
  totalFailedOrMissing:list.length,priorityCounts:counts,
  // Never infer a current merchant certification from this repair queue.
  sourceActivationAllowed:false,items:list.slice(0,maxItems)};
}
