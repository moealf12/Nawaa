// Search HTTP lifecycle diagnostics. Measures server-side milestones only:
// 'finish' = bytes handed to Node's transport, NOT confirmed client delivery.
// 'close' before writableFinished = aborted/closed response.
// No query, product, price, URL, client address or credentials are recorded.
import {performance} from "node:perf_hooks";

const ms=value=>Number.isFinite(value)?Math.max(0,Math.round(value)):null;

export function createSearchHttpLifecycleTrace(res,{
  startedAt=performance.now(),
  now=()=>performance.now(),
  thresholdMs=10500,
  onSlow=()=>{},
}={}){
  let preparedAt=null;
  let prepared=null;
  let reported=false;
  const publish=status=>{
    if(reported)return;
    reported=true;
    const stoppedAt=now();
    const totalMs=ms(stoppedAt-startedAt);
    if(totalMs===null||totalMs<thresholdMs)return;
    const record={
      status,
      totalHttpMs:totalMs,
      // Time between response body preparation and Node's finish/close.
      // Includes JS backpressure/scheduling, not network delivery latency.
      afterPreparedMs:preparedAt===null?null:ms(stoppedAt-preparedAt),
      preCacheMs:prepared?.preCacheMs??null,
      cacheLookupMs:prepared?.cacheLookupMs??null,
      postCacheMs:prepared?.postCacheMs??null,
      cacheMode:prepared?.cacheMode??"unknown",
      coalescedOnEntry:prepared?.coalescedOnEntry??null,
      offers:prepared?.offers??null,
      headersSent:Boolean(res.headersSent),
      writableFinished:Boolean(res.writableFinished),
    };
    // Telemetry must never turn a valid shopper response into a failed one.
    try{onSlow(record);}catch{}
  };
  res.once("finish",()=>publish("finished"));
  res.once("close",()=>{if(!res.writableFinished)publish("client_closed");});
  return {
    markPrepared(detail={}){
      preparedAt=now();
      prepared={
        preCacheMs:ms(detail.preCacheMs),
        cacheLookupMs:ms(detail.cacheLookupMs),
        postCacheMs:ms(detail.postCacheMs),
        cacheMode:["fresh","miss","stale","stale-if-error"].includes(detail.cacheMode)
          ?detail.cacheMode:"unknown",
        coalescedOnEntry:typeof detail.coalescedOnEntry==="boolean"
          ?detail.coalescedOnEntry:null,
        offers:Number.isInteger(detail.offers)&&detail.offers>=0
          ?Math.min(detail.offers,100000):null,
      };
    },
  };
}
