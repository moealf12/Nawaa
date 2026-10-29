// Production read-only, bounded multi-source customer acceptance.
// A live merchant count is evidence only for this query, timestamp and deployed SHA.
// No prices, links, cookies, credentials or raw merchant payloads are logged.
// Does not treat HTTP 200 or an unknown JSON schema as accepted product coverage.
const origin=process.env.NAWAA_PRODUCTION_ORIGIN || "https://nawaa-search-api.onrender.com";
const expected=process.env.NAWAA_EXPECT_LIVE_SHA || null;
const queries=["iPhone","iPhone 17","iPhone 17 256GB","آيفون","آيفون 17","Samsung Galaxy S25","PS5","سماعات بلوتوث","bluetooth headphones","سماعات","laptop"];
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
// Classify source failures without logging untrusted merchant messages, source URLs
// or embedded credentials. Preserve unknown when evidence is insufficient.
function sourceFailureClass(entry){
  const raw=String(entry?.code??entry?.errorCode??entry?.error??entry?.message??"");
  if(/timeout|timed? out|abort/i.test(raw))return "TIMEOUT";
  if(/(?:^|\D)403(?:\D|$)|access.denied/i.test(raw))return "HTTP_403";
  if(/(?:^|\D)429(?:\D|$)|rate.limit/i.test(raw))return "HTTP_429";
  if(/(?:^|\D)5\d\d(?:\D|$)/i.test(raw))return "HTTP_5XX";
  if(/fetch failed|network|econnreset|enotfound|eai_again|socket/i.test(raw))return "TRANSPORT_FAILURE";
  if(/invalid|malformed|parse/i.test(raw))return "INVALID_RESPONSE";
  return "UNKNOWN";
}
function extraSourceId(entry){
  return /^(extra|extra-sa|extra-unbxd)$/i.test(String(entry?.sourceId??entry?.provider??entry?.id??""));
}
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
    serverDurationMs:Number.isFinite(Number(body.durationMs)) ? Number(body.durationMs) : null,
    cacheMode:["fresh","miss","stale","stale-if-error"].includes(body.cache?.mode)
      ?body.cache.mode:"unknown",
    serverDeadlineMs:Number.isFinite(Number(body.coverage?.requestDeadlineMs))
      ?Number(body.coverage.requestDeadlineMs):null,
    serverDeadlineExceeded:body.coverage?.deadlineExceeded===true,
    fallbackUsed:body.coverage?.fallbackUsed===true,
    schemaRecognized:Array.isArray(offers),
    publishedOfferCount:offers?.length??0,
    structurallyEligible:eligible.length,
    structurallyInvalid:(offers?.length??0)-eligible.length,
    merchantCounts,
    providerRecords:providers.length,
    extraProviderRecords:providers.filter(extraSourceId).length,
    extraProviderReportedOffers:providers.filter(extraSourceId)
      .reduce((n,p)=>n+(Number(p?.returnedOffers)||0),0),
    extraFailureClasses:errors.filter(extraSourceId).map(sourceFailureClass).slice(0,8),
    reportedSourceErrors:errors.length,
    errorSourceIds:errors.slice(0,12).map(e=>bounded(e?.sourceId||e?.provider)),
    partial:body.coverage?.complete===false,
  };
}

// A single independently sampled SSE request checks completed customer transport.
// This is not JSON/SSE parity: merchant state may change between independent requests.
async function observeCompletedSse(query){
  const controller=new AbortController();
  const started=Date.now();
  const deadline=setTimeout(()=>controller.abort(Error("SSE_PROBE_DEADLINE")),18000);
  let httpStatus=null,snapshots=0,completeEvent=false,errorEvents=0,bytes=0;
  let lastOffers=[],coverage=null,buffer="";
  try{
    const response=await fetch(new URL("/api/search/stream?q="+encodeURIComponent(query),origin),{
      headers:{accept:"text/event-stream"},redirect:"error",signal:controller.signal,
    });
    httpStatus=response.status;
    if(httpStatus!==200)throw Error("SSE_HTTP_"+httpStatus);
    if(!(response.headers.get("content-type")||"").includes("text/event-stream"))
      throw Error("SSE_CONTENT_TYPE");
    const decoder=new TextDecoder();
    for await(const chunk of response.body){
      bytes+=chunk.byteLength;
      if(bytes>MAX_RESPONSE_BYTES)throw Error("SSE_RESPONSE_LIMIT");
      buffer+=decoder.decode(chunk,{stream:true}).replace(/\r\n/g,"\n");
      let end;
      while((end=buffer.indexOf("\n\n"))>=0){
        const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const event=frame.match(/^event:\s*(.*)$/m)?.[1];
        if(event==="done"){completeEvent=true;break;}
        if(event==="error"){errorEvents++;continue;}
        if(event!=="snapshot")continue;
        const data=frame.split("\n").filter(x=>x.startsWith("data:"))
          .map(x=>x.slice(5).trimStart()).join("\n");
        const snapshot=JSON.parse(data);
        if(!Array.isArray(snapshot.offers))throw Error("SSE_SNAPSHOT_SCHEMA");
        snapshots++;
        lastOffers=snapshot.offers;
        coverage=snapshot.coverage||coverage;
      }
      if(completeEvent)break;
    }
    const invalid=lastOffers.filter(offer=>!validOffer(offer)).length;
    const merchants=[...new Set(lastOffers.map(x=>bounded(x?.merchant)).filter(Boolean))];
    return {query,httpStatus,snapshots,completeEvent,errorEvents,
      finalOffers:lastOffers.length,invalidFinalOffers:invalid,merchants,
      extraFinalOffers:lastOffers.filter(x=>bounded(x?.merchant).toLowerCase()==="extra").length,
      coveragePartial:coverage?.partial??(coverage?.complete===false),
      elapsedMs:Date.now()-started,
      passed:completeEvent&&snapshots>0&&invalid===0};
  }catch(error){
    return {query,httpStatus,snapshots,completeEvent,errorEvents,
      elapsedMs:Date.now()-started,passed:false,
      errorClass:bounded(error?.name||error?.message)};
  }finally{
    clearTimeout(deadline);
    controller.abort();
  }
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
const extraJsonQueries=valid.filter(x=>Object.keys(x.merchantCounts)
  .some(merchant=>merchant.toLowerCase()==="extra")).length;
const sse=healthOk?await observeCompletedSse("سماعات بلوتوث"):null;
if(sse)console.log(JSON.stringify({kind:"SSE",...sse}));
const iphoneSse=healthOk?await observeCompletedSse("iPhone"):null;
if(iphoneSse)console.log(JSON.stringify({kind:"SSE_IPHONE",...iphoneSse}));
const summary={kind:"SUMMARY",observedAtUtc:new Date().toISOString(),
  sampledQueries:queries.length,attemptedQueries:output.length,
  http200ValidSchema:valid.length,multiMerchantQueries:multi.length,
  singleMerchantQueries:single.length,emptyQueries:empty.length,
  extraJsonContributingQueries:extraJsonQueries,
  sseComplete:sse?.completeEvent??false,ssePassed:sse?.passed??false,
  iphoneSseComplete:iphoneSse?.completeEvent??false,
  iphoneSsePassed:iphoneSse?.passed??false,
  iphoneSseExtraOffers:iphoneSse?.extraFinalOffers??null,
  invalidOrFailedQueries:output.length-valid.length,
  result:healthOk&&valid.length===queries.length&&multi.length>=1&&
    extraJsonQueries>=1&&sse?.passed===true&&iphoneSse?.passed===true?"PASS":"FAIL",
  limitation:"Read-only bounded cohort; source participation is per query/time. Independent JSON/SSE requests do not prove parity, and structural validity does not attest prices."};
console.log(JSON.stringify(summary));
if(summary.result!=="PASS")process.exitCode=1;
