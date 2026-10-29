// Three read-only official Jarir PDP observations via Node -> Python.
// The existing candidate below is an explicit CI-only identity fixture (no
// index price); nothing is persisted or published to shoppers.
import {runJarirPythonPdp} from "../src/python-jarir-bridge.mjs";
import {admitJarirPythonObservation} from "../server/python-jarir-enrichment.mjs";

const CASES=[
  {
    sku:"666784",url:"https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html",
    title:"Apple iPhone 17 256GB Black",query:"iPhone 17 256GB",brand:"Apple",
    kind:"phone"
  },
  {
    sku:"668751",url:"https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html",
    title:"Sony PlayStation 5 Slim (DIG) 825GB SSD White",query:"PlayStation 5 Slim Digital",
    brand:"Sony",kind:"console"
  },
  {
    sku:"644723",url:"https://www.jarir.com/sa-en/sony-chroma-pearl-other-gaming-accessories-644723.html",
    title:"Sony Console Covers Gaming Accessory",query:"Sony Console Covers",
    brand:"Sony",kind:"accessory"
  }
];

const results=[];
for(const entry of CASES){
  const candidate={
    provider:"jarir-direct",providerMarket:"jarir-sa",merchant:"Jarir",
    merchantCountryCode:"SA",title:entry.title,sourceUrl:entry.url,
    condition:"new",availability:"unknown",
    productPrice:null,originalProductPrice:null,
    currency:"SAR",originalCurrency:"SAR",
    observedAt:new Date().toISOString(),
    sourceMeta:{productId:entry.sku,parsedFrom:"CI_ONLY_NO_INDEX_PRICE"},
    specs:{brand:entry.brand}
  };
  let result={
    test:"JARIR_NODE_PYTHON_CROSS_RUNTIME",sku:entry.sku,
    category:entry.kind,source:"jarir-sa",network:"direct",
    mode:"CI_READ_ONLY",published:false,persisted:false,
    candidatePrice:"NOT_OBSERVED",pythonEvidenceReceived:false,
    admitted:false,outcome:"NOT_OBSERVED"
  };
  try{
    const evidence=await runJarirPythonPdp(
      {url:entry.url,expectedSku:entry.sku},{timeoutMs:12000});
    const accepted=admitJarirPythonObservation(candidate,evidence,entry.query);
    result={...result,pythonEvidenceReceived:Boolean(evidence.response_sha256),
      sourceHash:evidence.response_sha256||null,skuMatches:evidence.sku===entry.sku,
      priceEvidencePresent:typeof evidence.price==="string"&&evidence.currency==="SAR",
      admitted:accepted.accepted,
      outcome:accepted.accepted?"NODE_PYTHON_EVIDENCE_ADMITTED":"NODE_ADMISSION_REJECTED",
      failureClass:accepted.accepted?null:accepted.reason,
      observation:accepted.accepted?{
        price:evidence.price,currency:evidence.currency,
        availability:evidence.availability,
        fieldSource:evidence.field_evidence?.price?.source
      }:null};
  }catch(error){
    result={...result,outcome:"PYTHON_SOURCE_CALL_FAILED",
      failureClass:/^PYTHON_JARIR_[A-Z_]+$/.test(String(error?.message||""))
        ?error.message:"SOURCE_RUNTIME_ERROR"};
  }
  results.push(result);
  process.stdout.write("NAWAA_JARIR_PYTHON_NODE_LIVE "+JSON.stringify(result)+"\n");
  // Bound the footprint of source-side reads. No attempts after a denial.
  if(entry!==CASES.at(-1))await new Promise(resolve=>setTimeout(resolve,1200));
}
const summary={
  test:"JARIR_PYTHON_THREE_PRODUCT_PROBE",checked:results.length,
  observed:results.filter(r=>r.pythonEvidenceReceived).length,
  admitted:results.filter(r=>r.admitted).length,
  blocked:results.filter(r=>!r.admitted).length,
  checkedSkus:results.map(r=>r.sku),published:0,persisted:0
};
process.stdout.write("NAWAA_JARIR_PYTHON_MULTI_SUMMARY "+JSON.stringify(summary)+"\n");
// Each result is evidence-scoped. A successful CI job only certifies that
// the bounded probe completed; it does not pretend denied offers were found.
