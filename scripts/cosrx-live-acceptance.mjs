// One-shot first-party COSRX smoke. Runs only in the dedicated CI job.
// Actual network traffic: one query + at most two official product .js reads.
// No browser spoof, no login, no proxy, no customer offer publication.
import {
  cosrxSearchUrl,parseCosrxSearchCards,verifyCosrxVariantJson
} from "../src/cosrx-evidence.mjs";
import {fetchCosrxPublicProductJson} from "../server/providers/cosrx-live.mjs";
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
const parsed=parseCosrxSearchCards(html,query,{
  requestedUrl:url,finalUrl:response.url,maxCards:50,
});
if(parsed.diagnostics.status!=="PARSED_QUERY_BOUND_USD_CARDS" ||
   parsed.candidates.length===0)
  throw Error("COSRX_SEARCH_EVIDENCE_UNAVAILABLE_"+parsed.diagnostics.status);
const attempts=[];
for(const card of parsed.candidates.slice(0,2)){
  signal.throwIfAborted();
  try{
    const json=await fetchCosrxPublicProductJson(card.sourceUrl,{signal,timeoutMs:6000});
    const evidence=verifyCosrxVariantJson(json.text,card);
    attempts.push({productId:card.productId,reason:evidence.reason,
      price:evidence.verified?evidence.price:null,
      variantId:evidence.verified?evidence.variantId:null});
    if(!evidence.verified)continue;
    if(evidence.customerPublishable||evidence.shippingToSaudiVerified||
       evidence.canShipToSaudi!==null)
      throw Error("COSRX_SAUDI_DELIVERY_FALSIFIED");
    console.info("NAWAA_COSRX_LIVE_ACCEPTANCE "+JSON.stringify({
      searchUrl:url,searchCards:parsed.candidates.length,
      validatedProductId:evidence.productId,
      exactVariantId:evidence.variantId,
      exactUSDPrice:evidence.price,
      globalAvailability:evidence.availability,
      shippingToSaudiVerified:evidence.shippingToSaudiVerified,
      customerPublishable:evidence.customerPublishable,
      requests:1+attempts.length,elapsedMs:Date.now()-started,status:"PASS",
    }));
    process.exit(0);
  }catch(error){
    if(signal.aborted)throw error;
    attempts.push({productId:card.productId,reason:error?.message||String(error)});
    if(/(?:HTTP_403|HTTP_429|DENIED|LIMITED)/i.test(String(error?.message)))break;
  }
}
console.error("NAWAA_COSRX_LIVE_EVIDENCE_FAILED "+JSON.stringify({
  searchCards:parsed.candidates.length,attempts,elapsedMs:Date.now()-started,
}));
process.exitCode=1;
