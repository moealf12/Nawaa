// Read-only shopper-search diagnosis of the existing PUBLIC production API.
// Uses GET only; no database credentials, authenticated requests or deploys.
// Required for source-quality prioritization; NEVER treats data as verified when transport fails.
import {writeFile,mkdir} from 'node:fs/promises';

const ROOT='https://nawaa-search-api.onrender.com';
const CASES=[
  {id:'iphone17',query:'iPhone 17'},
  {id:'hp_laptop',query:'HP laptop'},
  {id:'ps5',query:'PS5'},
];
const TIMEOUT_MS=90000;
const bounded=(text='',max=160)=>String(text??'').slice(0,max);
function hostname(value){
  try {const u=new URL(value);return u.protocol==='https:'?u.hostname:null}
  catch{return null}
}
function offerSummary(o={}){
  return {
    title:bounded(o.title,130),
    provider:bounded(o.provider,65),
    merchant:bounded(o.merchant,80),
    merchantCountryCode:bounded(o.merchantCountryCode,4),
    price:Number.isFinite(o.productPrice)?o.productPrice:null,
    currency:bounded(o.currency,8),
    imagePresent:Boolean(o.image||o.imageUrl),
    sourceDomain:hostname(o.sourceUrl),
    observedAt:bounded(o.observedAt,40),
    dataKind:bounded(o.dataKind,30),
    matchConfidence:Number.isFinite(o.matchConfidence)?o.matchConfidence:null,
    exactMatch:o.exactMatch===true,
  };
}
async function probe({id,query}){
  const started=Date.now();
  let response;
  try {
    const url=new URL('/api/search',ROOT);
    url.searchParams.set('q',query);
    response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(TIMEOUT_MS),redirect:'error'});
    const contentType=response.headers.get('content-type')||'';
    if(!contentType.includes('application/json'))throw Error('non_json_response');
    const payload=await response.json();
    const offers=Array.isArray(payload?.offers)?payload.offers:[];
    const providers=Array.isArray(payload?.providers)?payload.providers:[];
    const errors=Array.isArray(payload?.errors)?payload.errors:[];
    const domains=new Set(offers.map(x=>hostname(x.sourceUrl)).filter(Boolean));
    const merchants=new Set(offers.map(x=>x.merchant).filter(Boolean));
    const likelyProducts=offers.filter(x=>x.exactMatch===true);
    return {
      id,query,status:response.status,ok:response.ok,elapsedMs:Date.now()-started,
      revision:payload?.revision??null,
      count:offers.length,distinctMerchants:merchants.size,sourceDomains:domains.size,
      withImages:offers.filter(x=>x.image||x.imageUrl).length,
      withHttpsLinks:offers.filter(x=>hostname(x.sourceUrl)).length,
      exactMatches:likelyProducts.length,
      providersAttempted:providers.length,providersWithOffers:providers.filter(x=>(x.returnedOffers||0)>0).length,
      coverage:payload?.coverage??null,
      errors:errors.slice(0,15).map(e=>({sourceId:bounded(e.sourceId,80),provider:bounded(e.provider,80),error:bounded(e.error||e.message,140)})),
      samples:offers.slice(0,12).map(offerSummary),
      providerSamples:providers.slice(0,35).map(p=>({sourceId:bounded(p.sourceId,80),ok:p.ok===true,returnedOffers:p.returnedOffers||0,elapsedMs:p.reliability?.latencyMs??null})),
      nextCursorPresent:typeof payload?.nextCursor==='string'&&payload.nextCursor.length>0,
      error:response.ok?null:bounded(payload?.error||payload?.message||'http_error',180),
    };
  }catch(error){
    return {id,query,ok:false,status:response?.status??null,elapsedMs:Date.now()-started,error:bounded(error?.message||error,180),count:null};
  }
}

const startedAt=new Date().toISOString();
const results=await Promise.all(CASES.map(probe));
const report={mode:'read-only-public-live-api',service:ROOT,startedAt,finishedAt:new Date().toISOString(),results};
await mkdir('reports',{recursive:true});
await writeFile('reports/nawaa-live-search-smoke.json',JSON.stringify(report,null,2)+'\n');
for(const x of results){
  console.log('LIVE_SEARCH_DIAGNOSTIC '+JSON.stringify({
    id:x.id,status:x.status,elapsedMs:x.elapsedMs,offers:x.count,
    merchants:x.distinctMerchants,domains:x.sourceDomains,images:x.withImages,
    exact:x.exactMatches,providersAttempted:x.providersAttempted,
    providersWithOffers:x.providersWithOffers,errors:x.errors?.slice(0,5),error:x.error,
    sample:x.samples?.slice(0,5),
  }));
}
console.log('LIVE_SEARCH_SUMMARY '+JSON.stringify({
  totalQueries:results.length,
  okQueries:results.filter(x=>x.ok).length,
  totalOffers:results.reduce((s,x)=>s+(x.count||0),0),
  complete:results.every(x=>x.ok)
}));
// Explicitly fail on unreachable API, but NEVER infer that a successful empty
// result means a particular source has a working connector.
if(results.some(x=>!x.ok))process.exitCode=2;
