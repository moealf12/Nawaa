// One-shot, explicitly opted-in BIKE24 transport compatibility check.
// No browser fingerprint preset, proxy, retries, redirects, or writes.
// This evidence MUST NOT be used to infer permission, HTTP/2 negotiation,
// independently attested price, availability, or shipping eligibility.
import {createRuntimeSourceFetcher} from "../server/source-transport.mjs";
import {NAWAA_INDEXER_USER_AGENT, merchantRequestHeaders}
  from "../src/source-http-profile.mjs";
import {extractBike24Product} from "../server/bike24-adapter.mjs";
import {bike24Identity} from "../src/bike24-product-truth.mjs";

const URL="https://www.bike24.com/p2735527.html";
const SOURCE="bike24-de";
const MAX_BYTES=4_000_000;
const started=Date.now();

if(process.env.NAWAA_IMPIT_SOURCE_IDS!==SOURCE ||
   process.env.NAWAA_BIKE24_IMPIT_PROBE!=="1"){
  throw Error("EXPLICIT_BIKE24_IMPIT_CI_OPT_IN_REQUIRED");
}

const evidence={
  source:SOURCE,productId:"2735527",transport:"impit-standard-no-browser-preset",
  announcedUserAgent:NAWAA_INDEXER_USER_AGENT,attempts:1,
  negotiatedHttpVersion:"NOT_OBSERVED_BY_FETCH_API",
  status:null,result:"NOT_ATTEMPTED",originalPriceEUR:null,
  variant:"UNKNOWN",verifiedOffer:false,saudiShippingVerified:false,
};
function report(){console.log("BIKE24_IMPIT_PROTOCOL_EVIDENCE "+JSON.stringify({
  ...evidence,durationMs:Date.now()-started,
}));}
try{
  const fetcher=createRuntimeSourceFetcher();
  const response=await fetcher(URL,{
    method:"GET",redirect:"error",
    headers:merchantRequestHeaders(SOURCE),
    signal:AbortSignal.timeout(9000),
  },{sourceId:SOURCE});
  evidence.status=response.status;
  if(response.status===403||response.status===429){
    evidence.result="ACCESS_DENIED_OR_LIMITED";
    process.exitCode=1;
  }else if(!response.ok){
    evidence.result="HTTP_NON_SUCCESS";
    process.exitCode=1;
  }else{
    const type=response.headers.get("content-type")||"";
    if(!/text\/html|application\/xhtml\+xml/i.test(type))
      throw Error("UNEXPECTED_CONTENT_TYPE");
    const body=response.body?.getReader();
    if(!body)throw Error("NO_READABLE_HTML_BODY");
    const chunks=[];let bytes=0;
    for(;;){
      const {value,done}=await body.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_BYTES){await body.cancel();throw Error("HTML_SIZE_LIMIT_EXCEEDED");}
      chunks.push(value);
    }
    const full=new Uint8Array(bytes);let cursor=0;
    for(const chunk of chunks){full.set(chunk,cursor);cursor+=chunk.byteLength;}
    const product=extractBike24Product(new TextDecoder().decode(full),URL);
    const identity=product?bike24Identity({
      title:product.name,sourceUrl:URL,mpn:product.mpn,gtin:product.gtin,
    }):null;
    const price=Number(product?.offers?.price);
    const correct=identity?.retailerProductId==="2735527" &&
      identity?.edition==="STANDARD" && product?.offers?.priceCurrency==="EUR" &&
      Number.isFinite(price)&&price>0;
    evidence.originalPriceEUR=correct?price:null;
    evidence.variant=identity?.edition||"UNKNOWN";
    evidence.result=correct?"PDP_PRICE_OBSERVED_NOT_ATTESTED":"PDP_EVIDENCE_INCOMPLETE";
    if(!correct)process.exitCode=1;
  }
}catch(error){
  evidence.result="REQUEST_OR_EXTRACTION_FAILED";
  evidence.errorClass=String(error?.message||"").slice(0,140);
  process.exitCode=1;
}finally{
  report();
}
