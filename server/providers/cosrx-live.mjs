// COSRX user-query-driven validation. Public first-party Shopify product .js;
// zero credentials, zero browser impersonation, no retries, strict USD parity.
import {createApprovedSourceFetcher} from "../source-transport.mjs";
import {NAWAA_INDEXER_USER_AGENT} from "../../src/source-http-profile.mjs";
import {
  cosrxProductJsonUrl,parseCosrxSearchCards,verifyCosrxVariantJson,
  cosrxSuggestUrl,parseCosrxSuggestCards,
} from "../../src/cosrx-evidence.mjs";

export const cosrxLiveConfigured=()=>process.env.NAWAA_COSRX_LIVE_ENABLED==="1";
const MAX_JSON_BYTES=512_000;
function fail(message,status=null) {
  const e=new Error(message);
  if(status!==null)e.status=status;
  return e;
}
export async function fetchCosrxPublicProductJson(
  url,{signal,fetchImpl=globalThis.fetch,timeoutMs=5500}={}
){
  const canonical=cosrxProductJsonUrl(url);
  if(!canonical||!/^https:\/\/www\.cosrx\.com\/products\/[a-z0-9-]+\.js$/.test(canonical))
    throw fail("COSRX_PRODUCT_URL_NOT_ALLOWED");
  signal?.throwIfAborted();
  const combined=AbortSignal.any([...(signal?[signal]:[]),
    AbortSignal.timeout(Math.max(1000,Math.min(7000,timeoutMs)))]);
  const fetcher=createApprovedSourceFetcher({
    fetchImpl,approvedSourceHosts:{"cosrx-global":["www.cosrx.com"]},
    optIn:false,
  });
  const response=await fetcher(canonical,{
    headers:{"accept":"application/json,text/javascript;q=0.9,*/*;q=0.2",
      "accept-language":"en-US,en;q=0.9",
      "user-agent":NAWAA_INDEXER_USER_AGENT},
    redirect:"manual",signal:combined,
  },{sourceId:"cosrx-global"});
  if(!response.ok)throw fail("COSRX_PRODUCT_HTTP_"+response.status,response.status);
  const returned=new URL(response.url||canonical);
  if(returned.href!==canonical)throw fail("COSRX_PRODUCT_REDIRECT_MISMATCH");
  const type=String(response.headers.get("content-type")||"").toLowerCase();
  if(type&&!/(?:json|javascript|text\/plain)/.test(type))
    throw fail("COSRX_PRODUCT_BAD_CONTENT_TYPE");
  const length=Number(response.headers.get("content-length")||0);
  if(length>MAX_JSON_BYTES)throw fail("COSRX_PRODUCT_TOO_LARGE");
  let body="";
  if(response.body?.getReader) {
    const reader=response.body.getReader();
    const dec=new TextDecoder();
    let bytes=0;
    try{
      for(;;){
        combined.throwIfAborted();
        const {value,done}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>MAX_JSON_BYTES)throw fail("COSRX_PRODUCT_TOO_LARGE");
        body+=dec.decode(value,{stream:true});
      }
      body+=dec.decode();
    }finally{reader.releaseLock();}
  }else{
    body=await response.text();
  }
  if(body.length>MAX_JSON_BYTES)throw fail("COSRX_PRODUCT_TOO_LARGE");
  return {text:body,finalUrl:canonical};
}
// First-party Shopify predictive search is a supported public JSON endpoint.
// Only use after the original query-specific HTML search returned without
// scoped cards. Never use after search 403/429, challenge or redirect.
export async function fetchCosrxPublicSuggestJson(
  query,{signal,fetchImpl=globalThis.fetch,timeoutMs=5500}={}
){
  const url=cosrxSuggestUrl(query);
  signal?.throwIfAborted();
  const combined=AbortSignal.any([...(signal?[signal]:[]),
    AbortSignal.timeout(Math.max(1000,Math.min(7000,timeoutMs)))]);
  const fetcher=createApprovedSourceFetcher({
    fetchImpl,approvedSourceHosts:{"cosrx-global":["www.cosrx.com"]},
    optIn:false,
  });
  const response=await fetcher(url,{
    headers:{"accept":"application/json,text/javascript;q=0.9",
      "accept-language":"en-US,en;q=0.9",
      "user-agent":NAWAA_INDEXER_USER_AGENT},
    redirect:"manual",signal:combined,
  },{sourceId:"cosrx-global"});
  if(!response.ok)throw fail("COSRX_SUGGEST_HTTP_"+response.status,response.status);
  if((response.url||url)!==url)throw fail("COSRX_SUGGEST_REDIRECT_MISMATCH");
  if(!/(?:json|javascript)/i.test(String(response.headers.get("content-type")||"")))
    throw fail("COSRX_SUGGEST_BAD_CONTENT_TYPE");
  const declared=Number(response.headers.get("content-length")||0);
  if(declared>MAX_JSON_BYTES)throw fail("COSRX_SUGGEST_TOO_LARGE");
  let body="";
  if(response.body?.getReader){
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let bytes=0;
    try{
      for(;;){
        combined.throwIfAborted();
        const {done,value}=await reader.read();
        if(done)break;
        bytes+=value.byteLength;
        if(bytes>MAX_JSON_BYTES)throw fail("COSRX_SUGGEST_TOO_LARGE");
        body+=decoder.decode(value,{stream:true});
      }
      body+=decoder.decode();
    }finally{reader.releaseLock();}
  }else{
    body=await response.text();
  }
  if(body.length>MAX_JSON_BYTES)throw fail("COSRX_SUGGEST_TOO_LARGE");
  return {text:body,finalUrl:url};
}
export async function evaluateCosrxSearch({
  query,html,searchUrl,finalUrl,fetchProductJson=fetchCosrxPublicProductJson,
  fetchSuggestJson=fetchCosrxPublicSuggestJson,
  signal,maxPdp=2,clock=()=>new Date().toISOString()
}={}){
  if(typeof fetchProductJson!=="function")throw TypeError("COSRX_JSON_FETCHER_REQUIRED");
  signal?.throwIfAborted();
  const listing=parseCosrxSearchCards(html,query,{
    requestedUrl:searchUrl,finalUrl,maxCards:100,
  });
  const records=[],verified=[];
  const budget=Math.max(0,Math.min(2,
    Number.isFinite(maxPdp)?Math.floor(maxPdp):2));
  if(!["PARSED_QUERY_BOUND_USD_CARDS","SEARCH_NO_VISIBLE_CARDS"].includes(listing.diagnostics.status))
    return {candidates:listing.candidates.length,verified,records,
      diagnostics:{...listing.diagnostics,checked:0,validated:0,
        customerPublishable:false,shippingToSaudiVerified:false}};
  let candidates=listing.candidates;
  let fallbackDiagnostics=null;
  let fallbackError=null;
  // Fallback only when SSR had *zero* cards, never when cards existed\n  // but were rejected due to conflicting product or price evidence.\n  if(!candidates.length&&listing.diagnostics.status==="SEARCH_NO_VISIBLE_CARDS"){
    try{
      const url=cosrxSuggestUrl(query);
      const response=await fetchSuggestJson(query,{signal});
      signal?.throwIfAborted();
      const predicted=parseCosrxSuggestCards(response?.text,query,{
        requestedUrl:url,finalUrl:response?.finalUrl||url});
      fallbackDiagnostics=predicted.diagnostics;
      candidates=predicted.candidates;
    }catch(error){
      if(signal?.aborted)throw signal.reason||error;
      const status=Number(error?.status||0);
      fallbackError=status===403?"SUGGEST_HTTP_403_DENIED":
        status===429?"SUGGEST_HTTP_429_LIMITED":"SUGGEST_FETCH_FAILED";
    }
  }
  for(const card of candidates.slice(0,budget)){
    signal?.throwIfAborted();
    try{
      const product=await fetchProductJson(card.sourceUrl,{signal});
      signal?.throwIfAborted();
      const evidence=verifyCosrxVariantJson(product?.text,card,{observedAt:clock()});
      records.push({productId:card.productId,...evidence});
      if(evidence.verified)verified.push({...card,...evidence});
    }catch(error){
      if(signal?.aborted)throw signal.reason||error;
      const status=Number(error?.status||0);
      records.push({productId:card.productId,verified:false,
        reason:status===403?"HTTP_403_DENIED":status===429?"HTTP_429_LIMITED":
          "PRODUCT_JSON_FETCH_FAILED",availability:"unknown",
        customerPublishable:false});
      if(status===403||status===429)break;
    }
  }
  return {candidates:candidates.length,verified,records,
    diagnostics:{...listing.diagnostics,
      status:fallbackDiagnostics?.status||listing.diagnostics.status,
      discoveryMethod:fallbackDiagnostics?"SHOPIFY_PREDICTIVE_JSON":"SEARCH_SSR",
      searchCardStatus:listing.diagnostics.status,
      suggestAttempted:listing.candidates.length===0,
      suggestDiagnostics:fallbackDiagnostics,
      suggestError:fallbackError,
      checked:records.length,validated:verified.length,
      customerPublishable:false,shippingToSaudiVerified:false}};
}
