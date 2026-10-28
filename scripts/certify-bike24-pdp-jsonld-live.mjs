// One-shot, user-approved, explicit BIKE24 Garmin PDP content-negotiation
// experiment. This is NOT the authorized JSON feed and cannot enable BIKE24.
// No browser TLS fingerprint, redirects, retries, proxy, storage or production.
import {createRuntimeSourceFetcher} from "../server/source-transport.mjs";
import {extractBike24PdpJsonLd} from "../src/bike24-pdp-jsonld.mjs";
import {NAWAA_INDEXER_USER_AGENT} from "../src/source-http-profile.mjs";

const URL="https://www.bike24.com/p2735527.html";
const EXPECTED_ID="2735527";
const STRUCTURED_ACCEPT="application/ld+json, application/json, text/html";
const MAX_BYTES=3_000_000;
const started=Date.now();
if(process.env.NAWAA_BIKE24_PDP_JSONLD_LIVE!=="1" ||
   process.env.NAWAA_IMPIT_SOURCE_IDS!=="bike24-de"){
  throw Error("EXPLICIT_BIKE24_PDP_ONE_SHOT_OPT_IN_REQUIRED");
}
const result={
  source:"bike24-de",sourceUrl:URL,attempts:1,
  announcedUserAgent:NAWAA_INDEXER_USER_AGENT,
  requestedAccept:STRUCTURED_ACCEPT,
  transport:"impit-standard-no-browser-fingerprint",
  negotiatedHttpVersion:"NOT_EXPOSED_BY_FETCH_INTERFACE",
  httpStatus:null,mimeType:null,decision:"NOT_STARTED",
  exactEdition:null,priceEUR:null,merchantPriceAttested:false,
  searchPdpParity:false,saudiShippingVerified:false,
};
const safeReport=()=>console.log("BIKE24_PDP_JSONLD_ONE_SHOT "+JSON.stringify({
  ...result,elapsedMs:Date.now()-started,
}));
try{
  const fetcher=createRuntimeSourceFetcher();
  const response=await fetcher(URL,{
    method:"GET",headers:{accept:STRUCTURED_ACCEPT},
    signal:AbortSignal.timeout(8500),
  },{sourceId:"bike24-de",structuredPdp:true});
  result.httpStatus=response.status;
  result.mimeType=(response.headers.get("content-type")||"").split(";")[0];
  if(response.status===403||response.status===429){
    result.decision="ACCESS_DENIED_OR_RATE_LIMITED";
    process.exitCode=1;
  }else if(!response.ok){
    result.decision="HTTP_NON_SUCCESS";
    process.exitCode=1;
  }else if(!/^text\/html$|^application\/xhtml\+xml$/.test(result.mimeType)){
    // Accept only negotiates preferences; a returned JSON response needs
    // its own documented, owned JSON parser. Do not misparse as HTML.
    result.decision="UNSUPPORTED_STRUCTURED_REPRESENTATION";
    process.exitCode=1;
  }else{
    const reader=response.body?.getReader();
    if(!reader)throw Error("NO_READABLE_BODY");
    const chunks=[];let size=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();throw Error("PDP_BODY_LIMIT_EXCEEDED")}
      chunks.push(value);
    }
    const full=new Uint8Array(size);let at=0;
    for(const v of chunks){full.set(v,at);at+=v.byteLength;}
    const candidate=extractBike24PdpJsonLd(new TextDecoder().decode(full),URL);
    if(candidate?.retailerProductId===EXPECTED_ID &&
       candidate?.edition==="STANDARD" &&
       candidate?.originalCurrency==="EUR" &&
       Number.isFinite(candidate?.originalProductPrice)){
      result.decision="PDP_JSONLD_OBSERVED_NOT_ATTESTED";
      result.exactEdition="STANDARD";
      result.priceEUR=candidate.originalProductPrice;
    }else{
      result.decision="PDP_JSONLD_NOT_VERIFIED";
      process.exitCode=1;
    }
  }
}catch(error){
  result.decision="REQUEST_OR_EXTRACTION_FAILED";
  result.errorClass=String(error?.message||error).slice(0,130);
  process.exitCode=1;
}finally{safeReport();}
