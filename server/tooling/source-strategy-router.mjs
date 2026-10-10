// NAWAA zero-cost strategy router: bounded, deterministic background extraction.
// This module does not change any customer search endpoints or initiate network requests.
const DEFAULT_ORDER=Object.freeze(["crawlee","jina","crawl4ai","firecrawl"]);
const asNumber=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>=0?Number(value):fallback;
export function chooseExtractionStrategies({source={},capabilities={},quota={},env=process.env}={}) {
  const order=Array.isArray(source.preferredStrategies)&&source.preferredStrategies.length
    ? source.preferredStrategies.filter(x=>DEFAULT_ORDER.includes(x))
    : [...DEFAULT_ORDER];
  const unique=[...new Set(order)];
  return unique.filter(strategy=>{
    if(strategy==="crawlee") return capabilities.crawlee!==false;
    if(strategy==="jina") return capabilities.jina===true && Boolean(env.JINA_API_KEY) && asNumber(quota.jinaRemaining,0)>0;
    if(strategy==="crawl4ai") return capabilities.crawl4ai===true;
    // Paid/credit-limited fallback can only be opted into explicitly.
    if(strategy==="firecrawl")return capabilities.firecrawl===true && env.NAWAA_ALLOW_CREDIT_EXTRACTOR==="1" && asNumber(quota.firecrawlRemaining,0)>0;
    return false;
  });
}
export async function runExtractionFallback({strategies,handlers,validate,resultLimit=50,signal}={}) {
  if(!Array.isArray(strategies)||!handlers||typeof validate!=="function")throw new TypeError("invalid_extraction_router_config");
  const limit=Math.max(1,Math.min(100,Math.trunc(asNumber(resultLimit,50))));
  const attempts=[];
  for(const strategy of [...new Set(strategies)]){
    if(signal?.aborted)throw new Error("extraction_aborted");
    const handler=handlers[strategy];
    if(typeof handler!=="function"){attempts.push({strategy,status:"not_configured"});continue;}
    try {
      const raw=await handler({signal,limit});
      if(signal?.aborted)throw new Error("extraction_aborted");
      if(!Array.isArray(raw)){attempts.push({strategy,status:"invalid_response"});continue;}
      const offers=[];
      for(const offer of raw.slice(0,limit)) {
        try{const normalized=validate(offer);if(normalized)offers.push(normalized);}catch{}
      }
      if(offers.length){attempts.push({strategy,status:"success",count:offers.length});return {strategy,offers,attempts};}
      attempts.push({strategy,status:"no_valid_offers"});
    } catch(error) {
      if(signal?.aborted)throw new Error("extraction_aborted");
      attempts.push({strategy,status:"failed",reason:String(error?.code||error?.message||"unknown").slice(0,80)});
    }
  }
  return {strategy:null,offers:[],attempts};
}
