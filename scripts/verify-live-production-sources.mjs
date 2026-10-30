// NAWAA read-only public-production acceptance: actual HTTP traffic, no fixtures,
// no merchant-direct crawling, no credentials, no database writes, no Firecrawl.
// Each query makes exactly one request; absence of offers is reported as a failure,
// not silently described as successful merchant acquisition.
import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";

const origin="https://nawaa-search-api.onrender.com";
const expected=process.env.NAWAA_EXPECT_LIVE_SHA;
const evidence={
  mode:"PUBLIC_PRODUCTION_READ_ONLY",
  synthetic:false,
  merchantAttestation:false,
  noPaidServices:true,
  startedAt:new Date().toISOString(),
  expectedRevision:expected||null,
  checks:[],
  searches:[],
  streams:[],
};
function check(name,ok,details={}) {
  evidence.checks.push({name,result:ok?"PASS":"FAIL",...details});
  if(!ok)throw new Error(name+"_FAILED");
}
async function get(path,{timeoutMs=45000,accept="application/json",parse="json"}={}) {
  const began=Date.now();
  const response=await fetch(origin+path,{
    method:"GET",headers:{accept},redirect:"error",
    signal:AbortSignal.timeout(timeoutMs),
  });
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength>3_000_000)throw new Error("RESPONSE_TOO_LARGE");
  const content=new TextDecoder().decode(bytes);
  const payload=parse==="json"?JSON.parse(content):content;
  return {status:response.status,elapsedMs:Date.now()-began,payload,
    contentType:response.headers.get("content-type")||""};
}
function validOffer(o){
  try {
    return o&&typeof o.title==="string"&&o.title.trim().length>0&&
      typeof o.merchant==="string"&&o.merchant.trim().length>0&&
      Number.isFinite(Number(o.productPrice))&&Number(o.productPrice)>0&&
      /^[A-Z]{3}$/.test(String(o.currency||""))&&
      new URL(o.sourceUrl).protocol==="https:";
  }catch{return false}
}
try {
  check("EXPECTED_SHA_VALID",typeof expected==="string"&&/^[0-9a-f]{40}$/i.test(expected));
  const health=await get("/health",{timeoutMs:70000});
  evidence.health={status:health.status,elapsedMs:health.elapsedMs,
    revision:health.payload?.revision||null};
  check("HEALTH_HTTP_200",health.status===200&&health.payload?.ok===true);
  check("EXACT_LIVE_REVISION",health.payload?.revision===expected);
  const free=health.payload?.liveProviders?.freeStorefronts||[];
  const legacy=health.payload?.liveProviders?.noon;
  evidence.noonRouting={scopedSourceConfigured:free.includes("noon-sa"),legacyProviderEnabled:legacy};
  check("NOON_SINGLE_PROVIDER",free.includes("noon-sa")&&legacy===false);

  const ui=await get("/search.html",{timeoutMs:45000,accept:"text/html",parse:"text"});
  evidence.searchHtml={status:ui.status,elapsedMs:ui.elapsedMs};
  check("SEARCH_HTML_LIVE",ui.status===200&&ui.contentType.includes("text/html")&&
    ui.payload.includes("search"));

  const sources=await get("/api/sources");
  const entries=Array.isArray(sources.payload?.sources)?sources.payload.sources:[];
  evidence.sourceRegistry={httpStatus:sources.status,count:entries.length,
    noonCount:entries.filter(x=>x.id==="noon-sa").length};
  check("SOURCE_REGISTRY_HTTP_200",sources.status===200&&Array.isArray(sources.payload?.sources));
  check("ONE_NOON_SOURCE_RECORD",evidence.sourceRegistry.noonCount===1);

  const cases=[
    ["smartphone","en","iPhone 17 256GB"],
    ["smartphone","ar","ايفون 17 256 جيجا"],
    ["gaming","en","PS5"],
    ["gaming","ar","بلايستيشن 5"],
    ["audio","en","Bluetooth headphones"],
    ["audio","ar","سماعات بلوتوث"],
    ["computing","en","laptop"],
    ["computing","ar","لابتوب"],
  ];
  for(const [group,language,query] of cases){
    const res=await get("/api/search?q="+encodeURIComponent(query),{timeoutMs:32000});
    const data=res.payload||{};
    const offers=Array.isArray(data.offers)?data.offers:[];
    const invalid=offers.filter(x=>!validOffer(x));
    const result={
      group,language,query,
      status:res.status,
      requestMs:res.elapsedMs,
      totalOffers:offers.length,
      structurallyValidOffers:offers.length-invalid.length,
      invalidOffers:invalid.length,
      exactMatches:offers.filter(x=>x.exactMatch===true).length,
      merchants:[...new Set(offers.map(x=>x?.merchant).filter(Boolean))].slice(0,12),
      providerYields:(Array.isArray(data.providers)?data.providers:[])
        .filter(x=>Number(x?.returnedOffers)>0)
        .map(x=>({id:String(x.sourceId||x.provider||"unknown").slice(0,80),
          count:Number(x.returnedOffers)})).slice(0,15),
      sourceErrors:Array.isArray(data.errors)?data.errors.length:0,
      coverageComplete:data.coverage?.complete===true,
    };
    evidence.searches.push(result);
    if(res.status!==200) evidence.checks.push({name:"SEARCH_HTTP_"+query,result:"FAIL"});
    if(invalid.length) evidence.checks.push({name:"INVALID_OFFERS_"+query,result:"FAIL",count:invalid.length});
    console.log("NAWAA_LIVE_SEARCH "+JSON.stringify(result));
  }
  check("ALL_SEARCH_REQUESTS_200",evidence.searches.length===8&&evidence.searches.every(x=>x.status===200));
  check("NO_MALFORMED_PUBLISHED_OFFERS",evidence.searches.every(x=>x.invalidOffers===0));
  check("LIVE_PRODUCT_YIELD_PRESENT",evidence.searches.some(x=>x.structurallyValidOffers>0));
  const categories=["smartphone","gaming","audio","computing"];
  const categoryEvidence=Object.fromEntries(categories.map(group=>[group,evidence.searches
    .filter(x=>x.group===group).reduce((count,x)=>count+x.structurallyValidOffers,0)]));
  evidence.categoryOfferCounts=categoryEvidence;
  // Record missing-category discovery rather than inventing source availability.
  check("FOUR_CATEGORIES_HAVE_STRUCTURALLY_VALID_OFFERS",
    categories.every(group=>categoryEvidence[group]>0),{categoryOfferCounts:categoryEvidence});

  // SSE is an independent live acquisition; its merchant yields may differ from
  // a JSON request that ran earlier. Check completion and evidence contracts,
  // not artificial equality between two time-separated searches.
  for(const [group,query] of [
    ["smartphone","iPhone 17 256GB"],["gaming","PS5"],
    ["audio","سماعات بلوتوث"],["computing","laptop"]
  ]){
    const response=await get("/api/search/stream?q="+encodeURIComponent(query),
      {timeoutMs:35000,accept:"text/event-stream",parse:"text"});
    let finalSnapshot=null,doneCount=0,errorCount=0,snapshotCount=0;
    for(const block of response.payload.split(/\r?\n\r?\n/)){
      const type=block.match(/^event: ([^\r\n]+)/m)?.[1];
      const body=block.match(/^data: (.+)$/m)?.[1];
      if(!type||!body)continue;
      let data;
      try{data=JSON.parse(body);}catch{throw new Error("SSE_INVALID_JSON_"+group);}
      if(type==="error")errorCount++;
      if(type==="done")doneCount++;
      if(type==="snapshot"){
        snapshotCount++;
        finalSnapshot=data;
      }
    }
    const offers=Array.isArray(finalSnapshot?.offers)?finalSnapshot.offers:[];
    const invalidOffers=offers.filter(o=>!validOffer(o)).length;
    const status={group,query,httpStatus:response.status,elapsedMs:response.elapsedMs,
      snapshotCount,doneCount,errorCount,finalOffers:offers.length,invalidOffers,
      coverageComplete:finalSnapshot?.coverage?.complete===true,
      coveragePartial:finalSnapshot?.coverage?.partial===true,
      finalRefreshing:finalSnapshot?.cache?.refreshing===true};
    evidence.streams.push(status);
    console.log("NAWAA_R01_LIVE_SSE "+JSON.stringify(status));
  }
  check("SSE_STREAMS_COMPLETE",evidence.streams.length===4&&
    evidence.streams.every(x=>x.httpStatus===200&&x.snapshotCount>0&&
      x.doneCount===1&&x.errorCount===0&&!x.finalRefreshing));
  check("SSE_NO_MALFORMED_PUBLISHED_OFFERS",evidence.streams.every(x=>x.invalidOffers===0));
  evidence.result="PASS";
}catch(error){
  evidence.result="FAIL";
  evidence.failure=String(error?.message||error).slice(0,180);
  process.exitCode=1;
}finally{
  evidence.finishedAt=new Date().toISOString();
  writeFileSync("live-production-source-acceptance.json",JSON.stringify(evidence,null,2)+"\n");
  console.log("NAWAA_LIVE_PRODUCTION_ACCEPTANCE "+JSON.stringify(evidence));
}