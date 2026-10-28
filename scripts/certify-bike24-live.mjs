// One explicit, read-only live BIKE24 PDP. Never a scheduled monitoring job.
// Production inventory/index is not touched. No retry, proxy or transport shift.
import assert from "node:assert/strict";
import {resolveProductUrl} from "../server/url-resolver.mjs";
import {bike24Identity,bike24PdpId} from "../src/bike24-product-truth.mjs";
import {inspectEuropeanOffer} from "../src/europe-source-yield.mjs";

const URL="https://www.bike24.com/p2735527.html";
const started=Date.now();
let pdp;
try{
  pdp=await resolveProductUrl(URL);
}catch(error){
  const status=Number(error?.status||String(error?.message||"").match(/\b(?:HTTP|returned)\s+(\d{3})\b/i)?.[1]);
  console.log("BIKE24_PDP_LIVE_EVIDENCE "+JSON.stringify({
    result:"REQUEST_OR_EXTRACTION_FAILED",
    observedHttpStatus:Number.isInteger(status)?status:null,
    errorClass:status===403||status===429?"ACCESS_DENIED_OR_LIMITED":
      /time.?out/i.test(String(error?.message||""))?"TIMEOUT":"OTHER_FAILURE",
    durationMs:Date.now()-started,attempts:1,
    verifiedOffer:false,
  }));
  process.exitCode=1;
}
if(pdp){
  const identity=bike24Identity({
    title:pdp.title,sourceUrl:pdp.resolvedPageUrl||pdp.sourceUrl,
    mpn:pdp.specs?.modelNumber,gtin:pdp.specs?.barcode
  });
  const inspected=inspectEuropeanOffer("bike24-de",{
    ...pdp,providerMarket:"bike24-de",
    merchantCountryCode:"DE",canShipToSaudi:null,
  });
  const evidence={
    result:identity?.retailerProductId==="2735527" &&
      identity?.edition==="STANDARD" && inspected.fieldsPass
      ?"PDP_FIELD_COMPLETE_NOT_ATTESTED":"PDP_EVIDENCE_INCOMPLETE",
    observedHttpStatus:200,
    productId:identity?.retailerProductId||null,
    edition:identity?.edition||null,
    originalCurrency:pdp.originalCurrency||null,
    originalProductPrice:pdp.originalProductPrice??null,
    convertedSAR:pdp.productPrice??null,
    identityHashPresent:Boolean(identity?.identityHash),
    observedStrategy:pdp.extraction?.strategy||null,
    fieldIssues:inspected.issues,
    sourcePriceEvidence:"PDP_OBSERVED_ONLY",
    independentlyConfirmedSearchPrice:false,
    saudiShippingVerified:false,
    verifiedOffer:false,
    attempts:1,durationMs:Date.now()-started,
  };
  console.log("BIKE24_PDP_LIVE_EVIDENCE "+JSON.stringify(evidence));
  assert.equal(evidence.result,"PDP_FIELD_COMPLETE_NOT_ATTESTED");
}
