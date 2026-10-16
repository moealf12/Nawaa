// Reproducible, credential-free candidate benchmark. Cold means a new server
// process; warm means the next SSE request in that process, NOT an API cache hit.
// Restarting cannot reset external/CDN/DNS caches. Report observations, not an SLA.
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const samples = Number(process.env.LATENCY_SAMPLES || 3);
if (!Number.isInteger(samples) || samples < 1 || samples > 10) throw Error('LATENCY_SAMPLES must be 1..10');
const queries = ['iPhone 17','PS5'];
const roots = process.argv.slice(2).length ? process.argv.slice(2).map(resolvePath => resolve(resolvePath)) : [process.cwd()];
const observations = [];
const revision = root => execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const versions = roots.map(root => ({root,sha:revision(root)}));
const valid = o => typeof o.title === 'string' && o.title.trim() &&
  Number.isFinite(o.productPrice) && o.productPrice > 0 && o.currency === 'SAR' &&
  typeof o.merchant === 'string' && o.merchant.trim() && o.merchant !== 'App' &&
  typeof o.sourceUrl === 'string' && o.sourceUrl.startsWith('https://') &&
  typeof o.observedAt === 'string' && Number.isFinite(Date.parse(o.observedAt));
async function launch(root) {
  const child = spawn(process.execPath,['--import',resolve(scriptDir,'search-latency-preload.mjs'),'server/server.mjs'],{
    cwd:root,env:{...process.env,PORT:'0',DATABASE_URL:'',MEILI_HOST:'',MEILI_MASTER_KEY:'',
      NOON_ENABLED:'false',CARREFOUR_ENABLED:'false',EBAY_ENABLED:'false',NODE_ENV:'test'},
    stdio:['ignore','pipe','pipe'],
  });
  let lines='',stderr=''; const transport=[],extraPhases=[];
  child.stderr.on('data',part => {stderr=(stderr+part).slice(-3000)});
  child.stdout.on('data',part => {
    lines+=part;
    let end;
    while((end=lines.indexOf('\n'))>=0){
      const line=lines.slice(0,end);lines=lines.slice(end+1);
      if(line.startsWith('LATENCY_TRANSPORT '))transport.push(JSON.parse(line.slice(18)));
      if(line.startsWith('EXTRA_PHASE_TIMING '))extraPhases.push(JSON.parse(line.slice(19)));
    }
  });
  return {child,transport,extraPhases,get stderr(){return stderr}};
}
async function measure(base,q,phase) {
  const start=performance.now(); let firstOfferMs=null,firstValidOfferMs=null,firstSources=[],last={},remaining='',done=false;
  const sourceFirstOfferMs={};
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch(base+'/api/search/stream?q='+encodeURIComponent(q),{signal:controller.signal});
    if(response.status!==200)throw Error('status_'+response.status);
    const decoder=new TextDecoder();
    for await (const chunk of response.body) {
      remaining+=decoder.decode(chunk,{stream:true});
      if(remaining.length>4_000_000)throw Error('sse_buffer_limit');
      let end;
      while((end=remaining.indexOf('\n\n'))>=0){
        const block=remaining.slice(0,end);remaining=remaining.slice(end+2);
        const event=block.match(/^event: (.+)$/m)?.[1],data=block.match(/^data: (.+)$/m)?.[1];
        if(event==='snapshot' && data){
          last=JSON.parse(data);
          const offers=last.offers||[];
          for(const offer of offers.filter(valid)){
            const source=offer.providerMarket||offer.provider;
            sourceFirstOfferMs[source] ??= Math.round(performance.now()-start);
          }
          if(firstOfferMs===null && offers.length)firstOfferMs=Math.round(performance.now()-start);
          if(firstValidOfferMs===null && offers.some(valid)){
            firstValidOfferMs=Math.round(performance.now()-start);
            firstSources=[...new Set(offers.filter(valid).map(o=>o.providerMarket||o.provider))];
          }
        }
        if(event==='done')done=true;
        if(event==='error')throw Error('sse_error');
      }
    }
    const offers=last.offers||[];
    return {q,phase,firstOfferMs,firstValidOfferMs,firstSources,sourceFirstOfferMs,finishedMs:Math.round(performance.now()-start),done,
      cacheMode:last.cache?.mode,count:offers.length,valid:offers.filter(valid).length,
      exact:offers.filter(o=>o.exactMatch).length,merchants:[...new Set(offers.map(o=>o.merchant))],
      falsePS5:q==='PS5'?offers.filter(o=>o.exactMatch && /\b(?:disc|disk|optical|blu ray)\s+drive\b/i.test(o.title) && !/\bconsole\b.*\b(?:with|includes?|including)\b/i.test(o.title)).length:0,
      coverage:last.coverage,errors:(last.errors||[]).map(e=>({sourceId:e.sourceId,market:e.market,error:e.error})),
      providers:(last.providers||[]).map(p=>({sourceId:p.sourceId,offers:p.returnedOffers,
        elapsedMs:p.elapsedMs,latencyEwmaMs:p.reliability?.latencyEwmaMs,
        stores:Array.isArray(p.diagnostics)?p.diagnostics.map(d=>({id:d.store,offers:d.verifiedOffers,latencyEwmaMs:d.reliability?.latencyEwmaMs})):undefined})),
    };
  }catch(error){return {q,phase,firstOfferMs,firstValidOfferMs,error:error.message,finishedMs:Math.round(performance.now()-start)};}
  finally{clearTimeout(timer);controller.abort();}
}
// Use an OS-assigned port without changing the production server's exports.
const portPreload=resolve(scriptDir,'search-latency-port.mjs');
for(let sample=1;sample<=samples;sample++)for(const q of queries){
  // Alternate baseline/candidate order to reduce time-order bias.
  for(const version of sample%2?versions:[...versions].reverse()){
    const oldOptions=process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS=[oldOptions,'--import',portPreload].filter(Boolean).join(' ');
    const server=await launch(version.root);
    if(oldOptions===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=oldOptions;
    try {
      const port=await new Promise((resolvePort,reject)=>{
        const timer=setTimeout(()=>reject(Error('server_start_timeout:'+server.stderr)),10000);
        server.child.once('exit',code=>{clearTimeout(timer);reject(Error('server_exit_'+code+':'+server.stderr));});
        server.child.stdout.on('data',part=>{const match=String(part).match(/LATENCY_PORT (\d+)/);if(match){clearTimeout(timer);resolvePort(Number(match[1]));}});
      });
      for(const phase of ['process-cold','process-warm']){
        server.transport.length=0;server.extraPhases.length=0;
        const result=await measure('http://127.0.0.1:'+port,q,phase);
        const record={sha:version.sha,sample,...result,transport:[...server.transport],extraPhases:[...server.extraPhases]};
        observations.push(record);console.log('LATENCY_SAMPLE '+JSON.stringify(record));
        if(!record.done || !record.valid || record.count!==record.valid || record.falsePS5)process.exitCode=1;
      }
    }finally{
      if(server.child.exitCode===null){const exited=once(server.child,'exit');server.child.kill('SIGTERM');await exited;}
    }
  }
}
const quantile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1]:null;
const summary=versions.flatMap(v=>queries.flatMap(q=>['process-cold','process-warm'].map(phase=>{
  const rows=observations.filter(r=>r.sha===v.sha&&r.q===q&&r.phase===phase);
  const times=rows.map(r=>r.firstValidOfferMs).filter(Number.isFinite);
  return {sha:v.sha,q,phase,n:rows.length,successes:times.length,medianMs:quantile(times,.5),maxMs:quantile(times,1),
    sampleP95Ms:times.length>=20?quantile(times,.95):null,sloCertified:false};
})));
console.log('LATENCY_SUMMARY '+JSON.stringify(summary));
if(process.env.LATENCY_OUTPUT)await writeFile(process.env.LATENCY_OUTPUT,JSON.stringify({versions,samples,summary,observations},null,2));
