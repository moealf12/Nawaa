// NAWAA v22.03: deterministic fixture benchmark, no merchant calls,
// no prices/SKUs/URLs in output and no inference about production recall.
import {performance} from "node:perf_hooks";
import {observeDecathlonSearchEvidence} from "../server/decathlon-shadow-gate.mjs";
import {evaluateDecathlonQuoteReadiness} from "../server/decathlon-quote-readiness.mjs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const url="https://decathlon.com.sa/products/test-runner";
function page(variantPrice="99.00",sku="SKU-1",variantId="12345",recordSku=sku){
  const graph={"@type":"Product",name:"Test Runner",url};
  const variants={productVariants:[{
    id:variantId,sku:recordSku,price:{amount:variantPrice,currencyCode:"SAR"},
    product:{url:"/products/test-runner",title:"Test Runner"},title:"Default Title",
  }]};
  return '<html><head><link rel="canonical" href="'+url+'">'+
    '<meta property="og:title" content="Test Runner">'+
    '<meta name="twitter:image" content="https://decathlon.com.sa/cdn/test.jpg"></head>'+
    '<body><main><div data-sku="'+sku+'"></div>'+
    '<form action="/cart/add"><input name="id" value="'+variantId+'"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(graph)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify(variants)+' });</script></body></html>';
}
const fixtures=[
  {kind:"consistent",search:page(),quote:page(),expected:"STOCK_AND_DELIVERY_UNVERIFIED"},
  {kind:"price_changed",search:page(),quote:page("109.00"),expected:"PRICE_CHANGED_REQUOTE_REQUIRED"},
  {kind:"sku_mismatch",search:page(),quote:page("99.00","OTHER-1"),expected:"SELECTED_PRODUCT_CHANGED"},
  {kind:"unattributed_price",search:page(),quote:page("99.00","SKU-1","12345","OTHER-1"),
    expected:"QUOTE_PRICE_OWNERSHIP_UNVERIFIED"},
];
function snapshot(html,at,id){return {
  url,finalUrl:url,httpStatus:200,html,receivedAtMs:at,requestId:id,
};}
function percentile(samples,fraction){
  const a=[...samples].sort((x,y)=>x-y);
  return Number(a[Math.min(a.length-1,Math.ceil(a.length*fraction)-1)].toFixed(3));
}
export function benchmarkDecathlonShadowQuote({iterations=30,now=()=>performance.now()}={}){
  if(!Number.isInteger(iterations)||iterations<1||iterations>300)
    throw Error("bounded_iterations_required");
  const latencyOff=[],latencyOn=[];
  let fixtureCount=0,incorrectPromotion=0,priceDriftDetected=0,errors=0;
  for(let n=0;n<iterations;n++)for(const input of fixtures){
    const beginOff=now();
    const off=observeDecathlonSearchEvidence({
      enabled:false,requestedUrl:url,finalUrl:url,html:input.search,
      fetchedAtMs:100_000,nowMs:101_000,
    });
    latencyOff.push(Math.max(0,now()-beginOff));
    const beginOn=now();
    const on=observeDecathlonSearchEvidence({
      enabled:true,requestedUrl:url,finalUrl:url,html:input.search,
      fetchedAtMs:100_000,nowMs:101_000,
    });
    latencyOn.push(Math.max(0,now()-beginOn));
    const decision=evaluateDecathlonQuoteReadiness({
      search:snapshot(input.search,100_000,"search"),
      quote:snapshot(input.quote,105_000,"quote"),
      nowMs:106_000,
    });
    fixtureCount++;
    if(off!==null||on?.trustedOfferEligible!==false||decision.quoteAllowed)
      incorrectPromotion++;
    if(decision.status!==input.expected)errors++;
    if(input.kind==="price_changed"&&decision.status==="PRICE_CHANGED_REQUOTE_REQUIRED")
      priceDriftDetected++;
  }
  return {
    schemaVersion:"nawaa.decathlon.quote-benchmark.fixture.v1",
    mode:"deterministic_fixture_only",
    fixtureCount,scenarioCount:fixtures.length,iterations,
    wrongQuoteOrOfferPromotions:incorrectPromotion,
    scenarioClassificationErrors:errors,
    priceDriftDetected,
    networkRequests:0,
    productionRecallImprovementCertified:false,
    productionPricePrecisionCertified:false,
    // These measure only local synchronous code paths; not production HTTP
    // P95, network impact, user-visible search or checkout latency.
    localShadowLatencyMs:{
      offP50:percentile(latencyOff,.50),offP95:percentile(latencyOff,.95),
      onP50:percentile(latencyOn,.50),onP95:percentile(latencyOn,.95),
    },
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(benchmarkDecathlonShadowQuote(),null,2)+"\n");
}
