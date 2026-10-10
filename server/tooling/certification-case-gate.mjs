// Executed only inside the offline source-certification runner.
// A source must return structurally valid offers matching a specifically
// requested device model to pass a model query. This DOES NOT modify search.
import {certifyModelTitleMatch} from "./source-model-evidence.mjs";
const HTTPS=/^https:\/\//i;
const HTTP_IMAGE=/^https?:\/\//i;
const OBVIOUS_ACCESSORY=/(?:\b(?:case for|cover for|compatible with|screen protector|protective case|silicone case|clear case|ear tips|replacement case|replacement ear|phone case)\b)/i;

export function evaluateCertificationOfferCase(query,offers,{negativeQuery="nawaa-unfindable-943271-20261003"}={}){
 if(typeof query!=="string"||!Array.isArray(offers))throw new TypeError("invalid_certification_case_input");
 const valid=offers.filter(o=>
  o&&typeof o.title==="string"&&o.title.trim().length>=3&&
  typeof o.sourceUrl==="string"&&HTTPS.test(o.sourceUrl)&&
  typeof o.image==="string"&&HTTP_IMAGE.test(o.image)&&
  Number.isFinite(o.productPrice)&&o.productPrice>0&&o.currency==="SAR");
 const validSet=new Set(valid);
 const invalid=offers.filter(o=>!validSet.has(o));
 const modelRule=certifyModelTitleMatch(query,"");
 const relevantValid=modelRule.restricted?valid.filter(o=>
  certifyModelTitleMatch(query,o.title).matches&&
  !OBVIOUS_ACCESSORY.test(o.title)):valid;
 const negative=query===negativeQuery;
 const pass=negative?offers.length===0:relevantValid.length>0;
 return {valid,invalid,relevantValid,pass,
  modelMatchRequired:modelRule.restricted,
  modelMatchedCount:relevantValid.length,
  modelRejectedCount:modelRule.restricted?valid.length-relevantValid.length:0,
  modelFailure:!negative&&modelRule.restricted&&valid.length>0&&relevantValid.length===0
   ?"QUERY_MODEL_MISMATCH":null};
}
