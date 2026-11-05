// Exact product-card acceptance from real first-party Noon UAE HTML.
// Runs on disposable CI only. No synthetic products and no production writes.
import {performance} from "node:perf_hooks";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

if(process.env.NAWAA_NOON_AE_PYTHON!=="1")
  throw Error("NOON_AE_LIVE_READER_GATE_DISABLED");

const queries=["iPhone 17","headphones","coffee machine"];
let passed=0,total=0;
const reports=[];
for(const query of queries){
  const started=performance.now();
  try{
    const result=await searchFreeStorefrontById("noon-ae",query,{
      matchingQuery:query,perStore:Infinity,catalogLimit:Infinity,
      productPageLimit:0,storeDeadlineMs:6500
    });
    const offers=(result.offers||[]).filter(x=>
      x.providerMarket==="noon-ae"&&
      x.originalCurrency==="AED"&&x.currency==="SAR"&&
      Number.isFinite(x.originalProductPrice)&&x.originalProductPrice>0&&
      Number.isFinite(x.productPrice)&&x.productPrice>0&&
      x.fx?.approximate===true&&
      x.sourceMeta?.sarDisplay==="APPROXIMATE_FX_CONVERSION"&&
      x.sourceMeta?.currencyEvidence&&
      /^https:\/\/www\.noon\.com\/uae-en\//.test(x.sourceUrl));
    total+=offers.length;
    if(offers.length>0)passed++;
    reports.push({query,observed:offers.length,
      elapsedMs:Math.round(performance.now()-started),
      sourceStatus:result.diagnostics?.noonUaeSearchCards?.status||null,
      acquisition:result.diagnostics?.searchPage?.acquisitionTransport||null,
      first:offers.length?{
        originalAED:offers[0].originalProductPrice,
        approximateSAR:offers[0].productPrice,
        rate:offers[0].fx.rate,
        observedAt:offers[0].fx.observedAt,
        skuModel:offers[0].specs?.modelNumber||null,
        fxSource:offers[0].fx.source,
      }:null,
    });
  }catch(error){
    reports.push({query,observed:0,
      elapsedMs:Math.round(performance.now()-started),
      failureClass:error?.failureClass||"SOURCE_ERROR",
      errorCode:String(error?.message||"SOURCE_ERROR").slice(0,100)});
  }
}
console.info("NOON_AE_PYTHON_LIVE_GATE "+JSON.stringify({
  schema:"nawaa.noon-ae.live-gate.v1",sampleSize:queries.length,
  queriesWithOffers:passed,verifiedOffers:total,sourceOwned:true,reports,
}));
if(passed<2||total<2)process.exitCode=1;
