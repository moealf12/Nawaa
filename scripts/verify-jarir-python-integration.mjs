// Live integration smoke; never persists, publishes or manufactures source prices.
// Requires Python dependencies installed by GitHub Actions; no user traffic.
import {runJarirPythonPdp} from "../src/python-jarir-bridge.mjs";
import {admitJarirPythonObservation} from "../server/python-jarir-enrichment.mjs";
const URL="https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html";
const SKU="666784";
const candidate={
  provider:"jarir-direct",providerMarket:"jarir-sa",merchant:"Jarir",
  merchantCountryCode:"SA",
  sourceUrl:URL,sourceMeta:{productId:SKU,parsedFrom:"CI_ONLY_PLACEHOLDER"},
  title:"Apple iPhone 17 256GB Black",condition:"new",
  productPrice:null,originalProductPrice:null,currency:"SAR",originalCurrency:"SAR",
  availability:"unknown",observedAt:new Date().toISOString(),
  specs:{brand:"Apple",storage:"256GB"}
};
let result={test:"JARIR_NODE_PYTHON_CROSS_RUNTIME",sku:SKU,
  source:"jarir-sa",network:"direct",mode:"CI_READ_ONLY",
  published:false,persisted:false,pythonEvidenceReceived:false,
  admitted:false,outcome:"NOT_OBSERVED"};
try{
  const evidence=await runJarirPythonPdp({url:URL,expectedSku:SKU},{timeoutMs:12000});
  const admitted=admitJarirPythonObservation(candidate,evidence,"iPhone 17 256GB");
  result={...result,pythonEvidenceReceived:Boolean(evidence.response_sha256),
    sourceHash:evidence.response_sha256||null,skuMatches:evidence.sku===SKU,
    hasPrice:typeof evidence.price==="string"&&evidence.currency==="SAR",
    admitted:admitted.accepted,
    outcome:admitted.accepted?"NODE_PYTHON_EVIDENCE_ADMITTED":"NODE_ADMISSION_REJECTED",
    failureClass:admitted.accepted?null:admitted.reason,
    observation:admitted.accepted?{
      price:evidence.price,currency:evidence.currency,
      stock:evidence.availability,fieldSource:evidence.field_evidence?.price?.source
    }:null};
}catch(error){
  result={...result,outcome:"PYTHON_SOURCE_CALL_FAILED",
    failureClass:/^PYTHON_JARIR_[A-Z_]+$/.test(String(error?.message||""))
      ?error.message:"SOURCE_RUNTIME_ERROR"};
}
process.stdout.write("NAWAA_JARIR_PYTHON_NODE_LIVE "+JSON.stringify(result)+"\n");
// A live source may decline access; CI records it distinctly from acceptance.
