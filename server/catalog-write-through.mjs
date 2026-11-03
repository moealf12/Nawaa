// R04 P3: bounded, verified customer-offer write-through to PostgreSQL.
// Live source evidence only. Never infer a source observation timestamp from
// query time, indexing time, process startup, cache replay or DB insertion.
import {persistenceConfigured,recordOffer} from "./persistence.mjs";
import {enforceCustomerOfferPublication} from "./customer-offer-output.mjs";

export const CATALOG_WRITE_WINDOW_MS=45_000;
export const CATALOG_WRITE_LIMIT=64;

export function selectFreshLiveObservations(offers,{
  now=Date.now(),maxRecords=CATALOG_WRITE_LIMIT,
}={}){
  if(!Array.isArray(offers)||!Number.isFinite(now)||
      !Number.isSafeInteger(maxRecords)||maxRecords<0||
      maxRecords>CATALOG_WRITE_LIMIT)
    throw new TypeError("invalid_catalog_write_window");
  const safe=enforceCustomerOfferPublication({offers}).offers;
  const selected=[];
  const seen=new Set();
  for(const offer of safe){
    if(selected.length>=maxRecords)break;
    if(offer?.dataKind!=="live")continue;
    if(typeof offer.title!=="string"||offer.title.trim().length<3)continue;
    const price=offer.productPrice;
    const currency=offer.currency;
    if(typeof price!=="number"||!Number.isFinite(price)||price<=0||
        typeof currency!=="string"||!/^[A-Z]{3}$/.test(currency))continue;
    if(typeof offer.sourceUrl!=="string")continue;
    let url;
    try{url=new URL(offer.sourceUrl);}
    catch{continue;}
    if(url.protocol!=="https:"||url.username||url.password||!url.hostname)continue;
    const ts=typeof offer.observedAt==="string"?Date.parse(offer.observedAt):NaN;
    if(!Number.isFinite(ts)||ts>now||now-ts>CATALOG_WRITE_WINDOW_MS)continue;
    const key=url.href+"|"+String(offer.condition||"new").toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);
    selected.push({...offer,
      // This timestamp comes unchanged from source evidence, NEVER Date.now().
      observedAt:new Date(ts).toISOString(),
    });
  }
  return selected;
}

export async function writeThroughFreshLiveObservations(query,offers,{
  configured=persistenceConfigured,
  record=recordOffer,
  now=Date.now(),
  maxRecords=CATALOG_WRITE_LIMIT,
}={}){
  if(!configured())return {configured:false,attempted:0,recorded:0,failed:0};
  const eligible=selectFreshLiveObservations(offers,{now,maxRecords});
  let recorded=0,failed=0;
  // Keep the free-tier PG connection pool bounded. Never leak source URLs,
  // queries, product details, DB exceptions or credentials in logs.
  for(const offer of eligible){
    try{
      // A provider object may itself include a `query` field; discard that
      // untrusted property as well as our own shopper search argument.
      const {query:_ignoredSearch, ...sourceEvidence}=offer;
      const result=await record({
        ...sourceEvidence,
        // Catalog attribution is merchant/source identity, never shopper PII.
        sourceName:offer.provider||offer.merchant||"live-retailer",
      });
      if(result?.recorded)recorded++;else failed++;
    }catch{failed++;}
  }
  return {configured:true,attempted:eligible.length,recorded,failed};
}

export const CATALOG_MAX_PENDING_BATCHES=3;

// One serialized write lane across concurrent shopper searches. The Render
// free instance can no longer accumulate unbounded independent 64-transaction
// jobs if a PostgreSQL connection stalls or merchants produce a burst of data.
export function createCatalogWriteQueue({
  configured=persistenceConfigured,
  writer=writeThroughFreshLiveObservations,
  maxPending=CATALOG_MAX_PENDING_BATCHES,
}={}){
  if(!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>8)
    throw new RangeError("invalid_catalog_queue_capacity");
  let pending=0;
  let tail=Promise.resolve();
  return {
    submit(query,offers){
      if(!configured())return Promise.resolve({
        configured:false,attempted:0,recorded:0,failed:0,
      });
      if(pending>=maxPending)return Promise.resolve({
        configured:true,attempted:0,recorded:0,failed:0,
        skipped:"catalog_backpressure",
      });
      const candidates=selectFreshLiveObservations(offers);
      if(!candidates.length)return Promise.resolve({
        configured:true,attempted:0,recorded:0,failed:0,
      });
      pending++;
      const job=tail.then(()=>writer(query,candidates));
      tail=job.catch(()=>{});
      return job.finally(()=>{pending--;});
    },
    stats:()=>({pending,maxPending}),
  };
}

const defaultCatalogWriteQueue=createCatalogWriteQueue();
export const scheduleCatalogWrite=(query,offers)=>
  defaultCatalogWriteQueue.submit(query,offers);
