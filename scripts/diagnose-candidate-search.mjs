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
try{
  await waitForHealth();
  const iphone=await query('iPhone 17');
  const ps5=await query('PS5');
  if(iphone.status!==200||ps5.status!==200)process.exitCode=2;
  if(ps5.falsePS5?.length)process.exitCode=3;
}finally{
  if(child.exitCode===null)child.kill('SIGTERM');
  await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);
}
