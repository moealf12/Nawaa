// Candidate-only, bounded cross-intent SSE observations. No retries, no extra
// provider calls, no database credentials, no production deploy. Never use
// these small live samples to certify a production percentile/SLO.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {firstOfferMilestones} from '../src/search-first-offer-metrics.mjs';

if(process.env.NODE_ENV!=='test')throw Error('candidate_test_environment_required');
const cases=[
  {label:'broad-hp',query:'HP'},
  {label:'specific-samsung-s25',query:'Samsung Galaxy S25'},
  {label:'specific-iphone-storage',query:'iPhone 17 256GB'},
  {label:'arabic-iphone',query:'ايفون 17'},
  {label:'arabic-ps5',query:'بلايستيشن 5'},
  {label:'accessory-disc-drive',query:'PS5 disc drive'},
  // v15.16 ten required independent English/Arabic PS5 customer intents.
  {label:'ps5-console',query:'PS5'},
  {label:'ps5-digital',query:'PS5 Digital'},
  {label:'ps5-disc',query:'PS5 Disc'},
  {label:'ps5-dualsense-bundle',query:'PS5 DualSense Bundle'},
  {label:'ps5-slim',query:'PS5 Slim'},
  {label:'ps5-ssd',query:'PS5 SSD'},
  {label:'ps5-ssd-heatsink',query:'PS5 SSD heatsink'},
  {label:'arabic-ps5-console',query:'بلايستيشن 5'},
  {label:'arabic-ps5-digital',query:'بلايستيشن 5 ديجيتال'},
  {label:'arabic-ps5-extra-controller',query:'بلايستيشن 5 مع يد إضافية'},
  {label:'negative',query:'nawaa-unfindable-943271-20261003'},
];
const port=await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
    const chosen=server.address().port;server.close(()=>resolve(chosen));
  });
});
if(!port)throw Error('ephemeral_port_unavailable');
const env={...process.env,PORT:String(port),DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:'',
  NOON_ENABLED:'false',CARREFOUR_ENABLED:'false',EBAY_ENABLED:'false',
  SEARCH_STREAM_DEADLINE_MS:'8000',NODE_ENV:'test'};
const child=spawn(process.execPath,['server/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
let stderr='',stdout='';
child.stderr.on('data',data=>{stderr=(stderr+data).slice(-1500)});
child.stdout.on('data',data=>{stdout=(stdout+data).slice(-1500)});
const origin='http://127.0.0.1:'+port;
async function waitForReady(){
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw Error('child_exited_'+child.exitCode);
    try{const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(700)});if(response.ok)return}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error('candidate_not_healthy:'+stderr);
}
async function observe(entry){
  const start=performance.now(),controller=new AbortController();
  const stop=setTimeout(()=>controller.abort(Error('bounded_live_sample_timeout')),9500);
  let firstValidMs=null,firstExactMs=null,firstValidSource=null,firstExactSource=null;
  let firstValidMerchant=null,firstExactMerchant=null;
  let finished=false,partial=null,available=0,exact=0,merchants=new Set();
  let sourceCount=0,streamError=null,lastCoverage=null,events=0,firstValidCount=0,firstExactCount=0;
  let responseStatus=null,buffer='',abortReason=null,lastOfferProvenance=[];
  try{
    const response=await fetch(origin+'/api/search/stream?q='+encodeURIComponent(entry.query),{
      headers:{accept:'text/event-stream'},signal:controller.signal});
    responseStatus=response.status;
    if(responseStatus!==200)throw Error('unexpected_http_'+responseStatus);
    const decoder=new TextDecoder();
    for await(const chunk of response.body){
      buffer+=decoder.decode(chunk,{stream:true});
      if(buffer.length>3e6)throw Error('sse_buffer_limit');
      let end;
      while((end=buffer.indexOf('\n\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const event=line.match(/^event: (.+)$/m)?.[1];
        const data=line.match(/^data: (.+)$/m)?.[1];
        if(event==='error')streamError='server_error_event';
        if(event==='done')finished=true;
        if(event!=='snapshot'||!data)continue;
        events++;
        const snapshot=JSON.parse(data),ms=Math.round(performance.now()-start);
        const offers=Array.isArray(snapshot.offers)?snapshot.offers:[];
        lastOfferProvenance=offers.filter(o=>o.providerMarket==='jarir-sa'&&
          ['627671','627678','670688','668751','677770','677771']
            .includes(String(o.sourceMeta?.productId||'')))
          .map(o=>({sku:String(o.sourceMeta.productId),price:o.productPrice,
            match:o.exactMatch,availability:o.availability,
            origin:o.sourceMeta?.parsedFrom||null,observedAt:o.observedAt}));
        const marker=firstOfferMilestones(offers);
        if(firstValidMs===null && marker.firstValid){
          firstValidMs=ms;firstValidSource=marker.firstValid.providerMarket||marker.firstValid.provider;
          firstValidMerchant=marker.firstValid.merchant;
          firstValidCount=marker.validCount;
        }
        if(firstExactMs===null && marker.firstExact){
          firstExactMs=ms;firstExactSource=marker.firstExact.providerMarket||marker.firstExact.provider;
          firstExactMerchant=marker.firstExact.merchant;
          firstExactCount=marker.exactCount;
        }
        available=marker.validCount;exact=marker.exactCount;
        merchants=new Set(offers.map(x=>x.merchant).filter(Boolean));
        lastCoverage=snapshot.coverage||null;
        partial=lastCoverage?.partial??partial;
        sourceCount=Array.isArray(snapshot.providers)?snapshot.providers.length:sourceCount;
      }
    }
  }catch(error){
    abortReason=controller.signal.aborted?'bounded_timeout_or_abort':String(error?.message||error).slice(0,100);
    if(!controller.signal.aborted)process.exitCode=1;
  }finally{clearTimeout(stop);controller.abort();}
  const observed={label:entry.label,httpStatus:responseStatus,clientFirstValidMs:firstValidMs,
    clientFirstExactMs:firstExactMs,firstValidSource,firstExactSource,
    firstValidMerchant,firstExactMerchant,firstValidCount,firstExactCount,
    finalValidOffers:available,finalExactOffers:exact,distinctMerchants:merchants.size,
    knownProviders:sourceCount,snapshots:events,completeEvent:finished,
    coveragePartial:partial,deadlineExceeded:lastCoverage?.deadlineExceeded??null,
    jarirCatalogEvidence:lastOfferProvenance,
    aborted:abortReason!==null,abortReason,elapsedMs:Math.round(performance.now()-start)};
  console.log('REPRESENTATIVE_SSE '+JSON.stringify(observed));
  if(responseStatus!==200||(firstExactMs!==null&&(firstValidMs===null||firstExactMs<firstValidMs)))process.exitCode=1;
  return observed;
}
const results=[];
try{
  await waitForReady();
  for(const entry of cases){
    // Sequential with zero retries avoids multiplying merchant traffic.
    results.push(await observe(entry));
  }
  console.log('REPRESENTATIVE_SUMMARY '+JSON.stringify({n:results.length,
    firstValidFound:results.filter(x=>x.clientFirstValidMs!==null).length,
    firstExactFound:results.filter(x=>x.clientFirstExactMs!==null).length,
    allHttp200:results.every(x=>x.httpStatus===200),
    timedOut:results.filter(x=>x.aborted).length,
    note:'single run per query; not production P95'}));
}finally{
  if(child.exitCode===null){
    child.kill('SIGTERM');
    await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,2000))]);
  }
}
