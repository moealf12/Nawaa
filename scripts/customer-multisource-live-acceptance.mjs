// Production read-only, bounded multi-source customer acceptance.
// A live merchant count is evidence only for this query, timestamp and deployed SHA.
// No prices, links, cookies, credentials or raw merchant payloads are logged.
// Does not treat HTTP 200 or an unknown JSON schema as accepted product coverage.
const origin=process.env.NAWAA_PRODUCTION_ORIGIN || "https://nawaa-search-api.onrender.com";
const expected=process.env.NAWAA_EXPECT_LIVE_SHA || null;
const queries=["iPhone","PS5","سماعات بلوتوث","laptop"];
const MAX_RESPONSE_BYTES=3_000_000;
const LIMIT_MS=23_000;

if(origin!=="https://nawaa-search-api.onrender.com")throw Error("PRODUCTION_ORIGIN_NOT_ALLOWLISTED");

async function readJson(path,timeoutMs=LIMIT_MS){
  const start=Date.now();
  const response=await fetch(new URL(path,origin),{
    headers:{accept:"application/json"},redirect:"error",
    signal:AbortSignal.timeout(timeoutMs),
  });
  const length=Number(response.headers.get("content-length")||0);
  if(length>MAX_RESPONSE_BYTES)throw Error("RESPONSE_LIMIT");
  const chunks=[];let total=0;
  if(response.body)for await(const chunk of response.body){
    total+=chunk.byteLength;
    if(total>MAX_RESPONSE_BYTES){
      await response.body.cancel().catch(()=>{});
      throw Error("RESPONSE_LIMIT");
    }
    chunks.push(chunk);
  }
  let body=null;
  try{body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch{throw Error("NON_JSON_RESPONSE");}
  return {status:response.status,body,elapsedMs:Date.now()-start};
}
function validOffer(offer){
  if(!offer||typeof offer!=="object")return false;
  if(typeof offer.title!=="string"||!offer.title.trim())return false;
  if(typeof offer.merchant!=="string"||!offer.merchant.trim())return false;
  if(typeof offer.productPrice!=="number"&&typeof offer.productPrice!=="string")return false;
  if(!Number.isFinite(Number(offer.productPrice))||Number(offer.productPrice)<=0)return false;
  if(!/^[A-Z]{3}$/.test(String(offer.currency||"")))return false;
  try{return new URL(offer.sourceUrl).protocol==="https:";}
  catch{return false;}
}
function bounded(s){return String(s??"unknown").replace(/[^a-zA-Z0-9 ._-]/g,"").slice(0,48)||"UNKNOWN";}
function summarize(query,response){
  const body=response.body||{};
  const offers=Array.isArray(body.offers)?body.offers:null;
  const eligible=offers?.filter(validOffer)||[];
  const merchantCounts={};
  for(const offer of eligible){
    const merchant=bounded(offer.merchant);
    merchantCounts[merchant]=(merchantCounts[merchant]||0)+1;
  }
  const providers=Array.isArray(body.providers)?body.providers:[];
  const errors=Array.isArray(body.errors)?body.errors:[];
  return {
    query,status:response.status,requestMs:response.elapsedMs,
    schemaRecognized:Array.isArray(offers),
    publishedOfferCount:offers?.length??0,
    structurallyEligible:eligible.length,
    structurallyInvalid:(offers?.length??0)-eligible.length,
    merchantCounts,
    providerRecords:providers.length,
    reportedSourceErrors:errors.length,
    errorSourceIds:errors.slice(0,12).map(e=>bounded(e?.sourceId||e?.provider)),
    partial:body.coverage?.complete===false,
  };
}

const startedAt=new Date().toISOString();
const baseline={kind:"BASELINE",observedAtUtc:startedAt,expected,origin,checks:[]};
let healthOk=false;
try{
  const health=await readJson("/health",12000);
  baseline.healthHttp=health.status;
  baseline.productionSha=health.body?.revision||null;
  baseline.sourcesConfigured=health.body?.liveProviders
    ? {jarir:health.body.liveProviders.jarir===true,
       extra:health.body.liveProviders.extra===true,
       freeStorefrontCount:Array.isArray(health.body.liveProviders.freeStorefronts)
         ?health.body.liveProviders.freeStorefronts.length:0}
    : null;
  healthOk=health.status===200&&health.body?.ok===true&&
    (!expected||health.body.revision===expected);
  baseline.checks.push({name:"HEALTH_REVISION",result:healthOk?"PASS":"FAIL"});
}catch(e){baseline.checks.push({name:"HEALTH_REVISION",result:"FAIL",reason:bounded(e.name||e.message)});}
console.log(JSON.stringify(baseline));

const output=[];
if(healthOk){
  for(const query of queries){
    try{
      const res=await readJson("/api/search?q="+encodeURIComponent(query));
      const row=summarize(query,res);
      output.push(row);
      console.log(JSON.stringify({kind:"SEARCH",...row}));
    }catch(error){
      const row={query,status:"REQUEST_ERROR",
        errorClass:bounded(error.name||error.message)};
      output.push(row);console.log(JSON.stringify({kind:"SEARCH",...row}));
    }
  }
}
const valid=output.filter(x=>x.status===200&&x.schemaRecognized&&x.structurallyInvalid===0);
const multi=valid.filter(x=>Object.keys(x.merchantCounts).length>=2);
const single=valid.filter(x=>Object.keys(x.merchantCounts).length===1);
const empty=valid.filter(x=>x.publishedOfferCount===0);
const summary={kind:"SUMMARY",observedAtUtc:new Date().toISOString(),
  sampledQueries:queries.length,attemptedQueries:output.length,
  http200ValidSchema:valid.length,multiMerchantQueries:multi.length,
  singleMerchantQueries:single.length,emptyQueries:empty.length,
  invalidOrFailedQueries:output.length-valid.length,
  result:healthOk&&valid.length===queries.length&&multi.length>=1?"PASS":"FAIL",
  limitation:"Read-only small live smoke; structured validity is not independent price verification."};
console.log(JSON.stringify(summary));
if(summary.result!=="PASS")process.exitCode=1;
