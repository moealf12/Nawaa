// One bounded public customer-search acceptance on the real Render service.
// Runs via free GitHub Actions after three scoped Render admin flags are enabled.
// Never writes databases, touches private secrets, retries merchant URLs,
// exposes visitor data, or derives trust badges from Python.
import assert from "node:assert/strict";

const ORIGIN="https://nawaa-search-api.onrender.com";
const EXPECTED=process.env.NAWAA_EXPECTED_MAIN_SHA||"";
const TARGET="666784";
if(!/^[0-9a-f]{40}$/.test(EXPECTED))throw Error("EXPECTED_MAIN_SHA_INVALID");

async function request(path,timeoutMs=12000){
  const resp=await fetch(ORIGIN+path,{
    method:"GET",redirect:"error",headers:{
      "accept":"application/json","cache-control":"no-cache",
      "user-agent":"NAWAA-ReadOnly-Production-Canary/1.0"
    },
    signal:AbortSignal.timeout(timeoutMs)
  });
  if(resp.status!==200)throw Error("PRODUCTION_HTTP_"+resp.status);
  const bytes=await resp.text();
  if(bytes.length>4_000_000)throw Error("PRODUCTION_RESPONSE_TOO_LARGE");
  return JSON.parse(bytes);
}

const start=performance.now();
let verified=false;
for(let attempt=0;attempt<36;attempt++){
  try{
    const health=await request("/health",6000);
    if(health.ok===true && health.revision===EXPECTED){verified=true;break;}
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
if(!verified)throw Error("PRODUCTION_SHA_NOT_READY");
const began=performance.now();
const search=await request("/api/search?q="+encodeURIComponent("iPhone 17 256GB"),25000);
assert.ok(Array.isArray(search.offers),"OFFERS_ARRAY_MISSING");
const jarir=search.offers.filter(offer=>
  offer?.merchant==="Jarir" && offer?.providerMarket==="jarir-sa" &&
  String(offer.sourceMeta?.productId||"")===TARGET &&
  offer.sourceUrl==="https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html"
);
const matched=jarir.find(offer=>offer.sourceMeta?.priceSource==="jarir-python-pdp-jsonld");
const data={
  test:"NAWAA_CUSTOMER_LIVE_PYTHON_CANARY",
  productionSha:EXPECTED,
  healthMatched:true,
  searchLatencyMs:Math.round(performance.now()-began),
  totalOffers:search.offers.length,
  targetJarirOffers:jarir.length,
  pythonSourceEvidence:!!matched,
  sku:TARGET,
  price:matched?.productPrice??null,
  currency:matched?.currency??null,
  availability:matched?.availability??null,
  nonPythonJarirOffers:jarir.filter(x=>x.sourceMeta?.priceSource!=="jarir-python-pdp-jsonld").length,
  publishedToCustomer:!!matched,
  elapsedMs:Math.round(performance.now()-start)
};
console.log("NAWAA_CUSTOMER_LIVE_PYTHON_CANARY "+JSON.stringify(data));
assert.ok(matched,"NO_PYTHON_CANARY_OFFER_IN_REAL_CUSTOMER_JSON");
assert.equal(matched.currency,"SAR");
assert.ok(Number.isFinite(matched.productPrice) && matched.productPrice>0);
assert.equal(matched.availability,"in_stock");
assert.equal(jarir.length,1,"MULTIPLE_SAME_SKU_JARIR_CUSTOMER_OFFERS");
