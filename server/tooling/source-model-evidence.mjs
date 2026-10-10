// Conservative model-token evidence from the few sample titles inside a
// certification artifact. Not a customer search relevance filter and never
// a substitute for matching SKU, variant, merchant price or shipping.
import {normalizeSearchQuery} from "../../src/search-query.mjs";

function requestedModel(query){
 const value=normalizeSearchQuery(query);
 if(/\bairpods\b/.test(value))return {model:"airpods",pattern:/\bairpods\b/i};
 let matched=/\biphone\s+(\d{1,2})\b/.exec(value);
 if(matched)return {model:"iphone "+matched[1],pattern:new RegExp("\\biphone\\s*"+matched[1]+"\\b","i")};
 matched=/\bgalaxy\s+s(\d{2})\b/.exec(value);
 if(matched)return {model:"galaxy s"+matched[1],pattern:new RegExp("\\bgalaxy\\s*s"+matched[1]+"\\b","i")};
 if(/\bps5\b/.test(value))
  return {model:"playstation 5",pattern:/\b(?:ps\s*5|playstation\s*(?:5|ps\s*5))\b/i};
 return null;
}
export function assessCertificationModelExamples(reportCase){
 const query=typeof reportCase?.query==="string"?reportCase.query:"";
 const rule=requestedModel(query);
 const validOffers=reportCase?.validCount;
 const examples=Array.isArray(reportCase?.examples)?
  reportCase.examples.filter(x=>x&&typeof x.title==="string"): [];
 if(!rule)return {query,model:null,status:"non_specific_query",
  validOffers:Number.isInteger(validOffers)?validOffers:0,examplesExamined:0};
 if(!Number.isSafeInteger(validOffers)||validOffers<0)
  return {query,model:rule.model,status:"invalid_offer_count",validOffers:null,examplesExamined:0};
 if(validOffers===0)
  return {query,model:rule.model,status:"no_valid_offers",validOffers:0,examplesExamined:0};
 const sample=examples.slice(0,Math.min(validOffers,2));
 const matches=sample.filter(x=>rule.pattern.test(x.title)).length;
 let status;
 if(sample.length===0)status="no_example_evidence";
 else if(matches>0)status="model_token_found_in_sample";
 else if(validOffers<=sample.length)status="exhaustive_sample_model_mismatch";
 else status="partial_sample_without_model_match";
 return {query,model:rule.model,status,validOffers,
  examplesExamined:sample.length,matchingExamples:matches,
  // Never copy titles/URLs into a downstream health/triage record.
  examplesNotMatching:sample.length-matches,
  coverage:validOffers<=sample.length?"all_valid_offers":"sample_only",
  certainty:status==="exhaustive_sample_model_mismatch"?
   "model_token_absent_in_all_returned_valid_titles":"incomplete_title_evidence"};
}
