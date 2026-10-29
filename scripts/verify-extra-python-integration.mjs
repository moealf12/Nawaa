// Direct live, read-only validation of the exact eXtra Python canary path.
// This tests the actual UNBXD provider first, then optionally its existing
// SKU's Python PDP evidence. Never writes DB or activates Render env vars.
import {searchExtraUnbxd} from "../server/providers/extra-unbxd.mjs";
const SKU="100462492";
const URL="https://www.extra.com/en-sa/mobiles-tablets/mobiles/smartphone/apple-iphone-17e-5g-6-1-512gb-soft-pink/p/100462492";
const QUERY="Apple iPhone 17e 512GB Soft Pink";

const originalEnv=Object.fromEntries(
  ["NAWAA_EXTRA_PYTHON_PDP","NAWAA_EXTRA_PYTHON_CANARY_QUERY",
   "NAWAA_EXTRA_PYTHON_CANARY_SKU","NAWAA_EXTRA_PYTHON_CANARY_URL"].map(k=>[k,process.env[k]])
);
process.env.NAWAA_EXTRA_PYTHON_PDP="1";
process.env.NAWAA_EXTRA_PYTHON_CANARY_QUERY=QUERY;
process.env.NAWAA_EXTRA_PYTHON_CANARY_SKU=SKU;
process.env.NAWAA_EXTRA_PYTHON_CANARY_URL=URL;
const started=performance.now();
const result={
  experiment:"EXTRA_PYTHON_NODE_UNBXD_LIVE",
  sourceId:"extra-sa",sku:SKU,queryScope:"EXACT_SKU_CI_ONLY",
  published:false,persisted:false,environmentChangedOnRender:false,
  originalOfferFound:false,pythonAttempted:0,pythonAccepted:0,
  outcome:"NOT_OBSERVED"
};
try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8500);
  try{
    const response=await searchExtraUnbxd(QUERY,24,QUERY,{signal:controller.signal});
    const original=response.offers.find(x=>x.sourceMeta?.productId===SKU);
    result.originalOfferFound=Boolean(original);
    result.offerCount=response.offers.length;
    result.pythonAttempted=response.diagnostics?.pythonExtraPdp?.attempted??0;
    result.pythonAccepted=response.diagnostics?.pythonExtraPdp?.accepted??0;
    result.pythonRejected=response.diagnostics?.pythonExtraPdp?.rejected??0;
    result.pythonFailed=response.diagnostics?.pythonExtraPdp?.failed??0;
    result.failureClasses=response.diagnostics?.pythonExtraPdp?.failureClasses??[];
    result.finalCanonicalSku=response.offers.find(x=>x.sourceMeta?.productId===SKU)?.sourceMeta?.productId??null;
    result.finalPriceSource=response.offers.find(x=>x.sourceMeta?.productId===SKU)?.sourceMeta?.priceSource??"UNBXD_ONLY";
    result.outcome=result.pythonAccepted===1 ? "LIVE_UNBXD_PYTHON_ADMITTED" :
      result.originalOfferFound ? "INDEX_OFFER_RETAINED" : "UNBXD_NO_MATCHING_OFFER";
    // No claims about exact prices without actual source evidence.
  }finally{
    clearTimeout(timer);
  }
}catch(error){
  result.outcome="LIVE_PROVIDER_UNAVAILABLE";
  const message=String(error?.message||"");
  result.failureClass=/\bHTTP\s*(403|429|5\d\d)\b/.test(message) ?
    "SOURCE_HTTP_"+message.match(/\bHTTP\s*(403|429|5\d\d)\b/)[1] :
    error?.name==="AbortError" ? "SOURCE_DEADLINE" : "SOURCE_TRANSPORT_OR_SEARCH_FAILURE";
}finally{
  for(const [key,value] of Object.entries(originalEnv)){
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
}
result.elapsedMs=Math.round(performance.now()-started);
process.stdout.write("NAWAA_EXTRA_PYTHON_NODE_LIVE "+JSON.stringify(result)+"\n");
// A completed workflow means this probe executed, not that the retailer
// returned a match or allowed access. Full results are in the log line.
