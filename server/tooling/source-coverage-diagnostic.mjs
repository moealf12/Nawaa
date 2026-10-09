// Certification evidence diagnostics: offline and strictly non-authorizing.
// Configured is not equivalent to extractable, price-verified or certified.
import {summarizeCertification} from "../../scripts/summarize-active-certification.mjs";
const BLOCKED=/\b403\b|\b401\b|blocked|captcha|forbidden|access denied/i;
const TIMEOUT=/timeout|timed out|aborted|fetch failed|network/i;
const IMAGE=/missing.images|image|picture/i;
const PRICE=/price|currency|invalid.offer|valid.offers|plausib/i;
const EMPTY=/no.product.candidates|without.valid.offers|no.results|empty|zero.results/i;
const clean=value=>String(value??"").replace(/[\r\n|<>]/g," ").slice(0,160);
function category(reason){
 if(BLOCKED.test(reason))return "merchant_access_blocked";
 if(TIMEOUT.test(reason))return "transport_or_timeout";
 if(IMAGE.test(reason))return "missing_product_images";
 if(PRICE.test(reason))return "offer_or_price_validation";
 if(EMPTY.test(reason))return "no_valid_product_candidates";
 if(reason==="No certification artifact")return "missing_evidence";
 if(/UNROUTED/.test(reason))return "routing_not_verified";
 return "other_certification_failure";
}
export function diagnoseActiveSourceCoverage(activeIds,reports,{requiredActiveCount=39,observedAt=null}={}){
 if(!Array.isArray(activeIds)||activeIds.some(id=>typeof id!=="string"||!/^[a-z0-9-]+$/.test(id))||
  new Set(activeIds).size!==activeIds.length||!(reports instanceof Map))
  throw new Error("invalid_source_diagnostic_input");
 if(observedAt!==null&&(!Number.isFinite(Date.parse(observedAt))||
  new Date(observedAt).toISOString()!==observedAt))
  throw new Error("invalid_source_diagnostic_timestamp");
 const strict=summarizeCertification(activeIds,reports,requiredActiveCount);
 const rows=strict.rows.map(row=>{
  const report=reports.get(row.id);
  const positives=Array.isArray(report?.cases)?report.cases.filter(x=>!String(x.query||"").startsWith("nawaa-unfindable-")):[];
  const candidates=positives.reduce((n,c)=>n+(Number.isSafeInteger(c.validCount)&&c.validCount>0?c.validCount:0),0);
  const evidenceStatus=row.status==="CERTIFIED"?"certified":
   row.status==="MISSING"?"not_tested":"failed";
  // A positive validCount is extraction evidence, NOT independent price parity.
  return {sourceId:row.id,configured:true,evidenceStatus,
   positiveQueriesPassed:row.positiveChecks,validOfferCandidates:candidates,
   extractionEvidence:candidates>0?"positive_candidates":"not_proven",
   independentPriceParity:"not_verified_by_this_report",
   imageReachability:"not_verified_by_this_report",
   diagnosis:evidenceStatus==="failed"?category(row.reason):
    evidenceStatus==="not_tested"?"missing_evidence":"certification_passed",
   reason:evidenceStatus==="certified"?null:clean(row.reason)};
 });
 const categories={};
 for(const row of rows)categories[row.diagnosis]=(categories[row.diagnosis]||0)+1;
 return {mode:"offline_certification_diagnostic",observedAt,
  requiredActiveCount,configured:rows.length,strictlyCertified:strict.stats.certified,
  failed:strict.stats.failed,missing:strict.stats.missing,
  verifiedPriceParityByIndependentPageEvidence:0,
  reportCertifiesAll:strict.passed,
  productionSourcesActivated:0,networkRequestsSent:0,
  categories,rows};
}
