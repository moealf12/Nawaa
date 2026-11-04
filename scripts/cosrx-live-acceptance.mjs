// One-shot first-party COSRX smoke. Runs only in the dedicated CI job.
// Actual network traffic: one query + at most two official product .js reads.
// No browser spoof, no login, no proxy, no customer offer publication.
import {cosrxSearchUrl} from "../src/cosrx-evidence.mjs";
import {evaluateCosrxSearch} from "../server/providers/cosrx-live.mjs";
import {merchantRequestHeaders} from "../src/source-http-profile.mjs";

if(process.env.NAWAA_COSRX_LIVE_SMOKE!=="1")throw Error("COSRX_LIVE_SMOKE_NOT_ENABLED");
const query="sunscreen",url=cosrxSearchUrl(query);
const started=Date.now();
const signal=AbortSignal.timeout(20000);
const response=await fetch(url,{
  method:"GET",redirect:"manual",signal,
  headers:merchantRequestHeaders("cosrx-global"),
});
if(!response.ok)throw Error("COSRX_SEARCH_HTTP_"+response.status);
if(response.url!==url)throw Error("COSRX_SEARCH_REDIRECT");
const mime=String(response.headers.get("content-type")||"").toLowerCase();
if(!/text\/html/.test(mime))throw Error("COSRX_SEARCH_CONTENT_TYPE");
const length=Number(response.headers.get("content-length")||0);
if(length>3_500_000)throw Error("COSRX_SEARCH_TOO_LARGE");
const html=await response.text();
const inspected=await evaluateCosrxSearch({
  query,html,searchUrl:url,finalUrl:response.url,
  signal,maxPdp:2,
});
const first=inspected.verified[0]||null;
if(!first){
  console.error("NAWAA_COSRX_LIVE_EVIDENCE_FAILED "+JSON.stringify({
    ...inspected.diagnostics,candidates:inspected.candidates,
    records:inspected.records.map(x=>({productId:x.productId,reason:x.reason})),
    elapsedMs:Date.now()-started,
  }));
  process.exitCode=1;
}else{
  if(first.customerPublishable||first.shippingToSaudiVerified||
     first.canShipToSaudi!==null)throw Error("COSRX_SAUDI_DELIVERY_FALSIFIED");
  console.info("NAWAA_COSRX_LIVE_ACCEPTANCE "+JSON.stringify({
    searchUrl:url,searchCards:inspected.candidates,
    discoveryMethod:inspected.diagnostics.discoveryMethod,
    validatedProductId:first.productId,
    exactVariantId:first.variantId,
    exactUSDPrice:first.price,
    globalAvailability:first.availability,
    shippingToSaudiVerified:first.shippingToSaudiVerified,
    customerPublishable:first.customerPublishable,
    requests:1+(inspected.diagnostics.suggestAttempted?1:0)+
      inspected.diagnostics.checked,
    elapsedMs:Date.now()-started,status:"PASS",
  }));
}
