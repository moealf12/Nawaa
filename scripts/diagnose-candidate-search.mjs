// Run the CANDIDATE server locally on the GitHub runner against real, public
// merchant endpoints. This tests product search wiring without deploying Render.
// No database/Meili credentials, writes, or production activation.
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';

const port=await new Promise((resolve,reject)=>{
  const s=net.createServer();
  s.once('error',reject);
  s.listen(0,'127.0.0.1',()=>{
    const p=s.address().port;
    s.close(()=>resolve(p));
  });
});
const env={
  ...process.env,PORT:String(port),DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:'',
  NOON_ENABLED:'false',CARREFOUR_ENABLED:'false',EBAY_ENABLED:'false',
  SEARCH_REQUEST_DEADLINE_MS:'12000',
};
const child=spawn(process.execPath,['server/server.mjs'],{env,stdio:['ignore','pipe','pipe']});
let out='',err='';
child.stdout.on('data',chunk=>{out=(out+chunk).slice(-2000)});
child.stderr.on('data',chunk=>{err=(err+chunk).slice(-2000)});
const base='http://127.0.0.1:'+port;
async function waitForHealth(){
  for(let i=0;i<55;i++){
    if(child.exitCode!==null)throw Error('candidate_server_exited:'+child.exitCode);
    try{
      const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});
      if(r.status===200)return;
    }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error('candidate_health_timeout:'+err.slice(0,250));
}
async function query(text){
  const start=Date.now();
  try{
    const r=await fetch(base+'/api/search?q='+encodeURIComponent(text),{
      headers:{accept:'application/json'},signal:AbortSignal.timeout(32000),
    });
    const data=await r.json();
    const offers=Array.isArray(data.offers)?data.offers:[];
    const exact=offers.filter(x=>x.exactMatch===true);
    const falsePS5=exact.filter(o=>/\b(?:disc|disk|optical|blu ray)\s+drive\b/i.test(o.title||'') &&
      !/\bconsole\b.*\b(?:with|includes?|including)\b/i.test(o.title||''));
    const result={
      q:text,status:r.status,elapsedMs:Date.now()-start,
      count:offers.length,exact:exact.length,
      merchants:[...new Set(offers.map(o=>o.merchant).filter(Boolean))].slice(0,15),
      providerSummary:(data.providers||[]).filter(p=>(p.returnedOffers||0)>0).map(p=>({sourceId:p.sourceId,offers:p.returnedOffers})),
      failures:(data.errors||[]).slice(0,7).map(e=>({id:e.sourceId,code:String(e.error||e.message||'').slice(0,110)})),
      falsePS5: falsePS5.map(o=>({title:o.title,price:o.productPrice})),
    };
    console.log('CANDIDATE_LIVE_SEARCH '+JSON.stringify(result));
    return result;
  }catch(error){
    const result={q:text,status:null,elapsedMs:Date.now()-start,error:String(error?.message||error).slice(0,200)};
    console.log('CANDIDATE_LIVE_SEARCH '+JSON.stringify(result));
    return result;
  }
}
async function measureStreamFirstOffer(text){
  const start=Date.now();
  let firstOfferMs=null;
  let firstMerchantCount=0;
  let finalOfferCount=0;
  let done=false;
  let snapshots=0;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new Error('sse_diagnostic_timeout')),25000);
  try{
    const r=await fetch(base+'/api/search/stream?q='+encodeURIComponent(text),{
      headers:{accept:'text/event-stream'},signal:controller.signal,
    });
    if(r.status!==200)throw Error('sse_status_'+r.status);
    const reader=r.body.getReader();
    const decoder=new TextDecoder();
    let remaining='';
    while(true){
      const {value,done:streamDone}=await reader.read();
      if(streamDone)break;
      remaining+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
      // Prevent a malformed server from accumulating an unbounded line buffer.
      if(remaining.length>2000000)throw Error('sse_buffer_limit');
      let end;
      while((end=remaining.indexOf('\n\n'))!==-1){
        const block=remaining.slice(0,end);
        remaining=remaining.slice(end+2);
        const event=block.match(/^event: (.+)$/m)?.[1];
        const data=block.match(/^data: (.+)$/m)?.[1];
        if(event==='snapshot'&&data){
          snapshots++;
          const parsed=JSON.parse(data);
          const offers=Array.isArray(parsed.offers)?parsed.offers:[];
          if(firstOfferMs===null&&offers.length){
            firstOfferMs=Date.now()-start;
            firstMerchantCount=new Set(offers.map(o=>o.merchant).filter(Boolean)).size;
          }
          finalOfferCount=offers.length;
        }
        if(event==='done'){done=true;break}
      }
      if(done)break;
    }
    const measurement={
      q:text,sseStatus:r.status,firstOfferMs,firstMerchants:firstMerchantCount,
      snapshots,finalOffers:finalOfferCount,finishedMs:Date.now()-start,done,
    };
    console.log('CANDIDATE_SSE_TIMING '+JSON.stringify(measurement));
    return measurement;
  } catch(error){
    const measurement={q:text,error:String(error?.message||error).slice(0,180),firstOfferMs,
      elapsedMs:Date.now()-start};
    console.log('CANDIDATE_SSE_TIMING '+JSON.stringify(measurement));
    return measurement;
  }finally{clearTimeout(timeout);controller.abort()}
}
try{
  await waitForHealth();
  // Cold-stream timing must run BEFORE the JSON search for the same query;
  // otherwise cachedSearch returns a warm snapshot and masks real first-offer delay.
  const stream=await measureStreamFirstOffer('iPhone 17');
  const iphone=await query('iPhone 17');
  const ps5=await query('PS5');
  if(iphone.status!==200||ps5.status!==200)process.exitCode=2;
  if(ps5.falsePS5?.length)process.exitCode=3;
  if(stream.sseStatus!==200||!stream.done||stream.firstOfferMs===null)process.exitCode=4;
}finally{
  if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);
}
