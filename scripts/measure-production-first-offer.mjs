// Read-only, bounded live SSE observations. Diagnostic only; zero merchant
// writes, quotes, production credentials, recurring probes or dependencies.
// These are client-received milestones, not server execution durations.
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {firstOfferMilestones} from '../src/search-first-offer-metrics.mjs';

const ORIGIN='https://nawaa-search-api.onrender.com';
const QUERIES=['PS5 Slim','iPhone 17 Pro','HP laptop','طابعة HP'];

export function sampleSummary(rows){
  const times=rows.map(x=>x.firstValidMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const quantile=p=>times.length?times[Math.ceil(times.length*p)-1]:null;
  return {
    attempts:rows.length,validFound:times.length,withoutValidOffer:rows.length-times.length,
    medianObservedMs:quantile(.5),minObservedMs:times[0]??null,maxObservedMs:times.at(-1)??null,
    // Small samples and heterogeneous queries cannot certify an SLO.
    p95Ms:null,p95Certified:false,targetMs:1500,
    observedAboveTarget:times.filter(ms=>ms>1500).length,
    note:'Small unstratified live sample; not production P95 or browser-render timing.',
  };
}

export async function collectFirstOfferEvents(response,{start,now=()=>performance.now()}={}){
  const out={status:response.status,firstByteMs:null,firstSnapshotMs:null,
    firstValidMs:null,firstExactMs:null,doneMs:null,snapshots:0,
    validOnFirstMilestone:null,finalOfferCount:0,finished:false,errorEvents:0,error:null};
  if(response.status!==200||!response.body){
    out.error='unexpected_http_'+response.status;return out;
  }
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer='';
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      const ms=Math.round(now()-start);
      if(out.firstByteMs===null)out.firstByteMs=ms;
      buffer+=decoder.decode(value,{stream:true});
      buffer=buffer.replace(/\r\n/g,'\n');
      if(buffer.length>3_000_000)throw Error('sse_buffer_limit');
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0){
        const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const type=block.match(/^event: (.+)$/m)?.[1],raw=block.match(/^data: (.+)$/m)?.[1];
        if(type==='error')out.errorEvents++;
        if(type==='done'){out.finished=true;out.doneMs=ms;break}
        if(type!=='snapshot'||!raw)continue;
        out.snapshots++;
        if(out.firstSnapshotMs===null)out.firstSnapshotMs=ms;
        const snapshot=JSON.parse(raw),offers=Array.isArray(snapshot.offers)?snapshot.offers:[];
        out.finalOfferCount=offers.length;
        const milestone=firstOfferMilestones(offers);
        if(out.firstValidMs===null&&milestone.firstValid){
          out.firstValidMs=ms;out.validOnFirstMilestone=milestone.validCount;
        }
        if(out.firstExactMs===null&&milestone.firstExact)out.firstExactMs=ms;
      }
      if(out.finished)break;
    }
  }catch(e){
    out.error=String(e?.name==='AbortError'?'request_timeout_or_abort':e?.message||e).slice(0,90);
  }finally{try{await reader.cancel()}catch{}}
  return out;
}

async function main(){
  const expected=process.env.NAWAA_EXPECTED_LIVE_SHA;
  if(!/^[a-f0-9]{40}$/.test(expected||''))throw Error('set_NAWAA_EXPECTED_LIVE_SHA_to_verified_main_commit');
  const repeats=Number(process.env.NAWAA_TIMING_REPEATS||'1');
  if(!Number.isInteger(repeats)||repeats<1||repeats*QUERIES.length>8)
    throw Error('bounded_requests_only_max_eight');
  const health=await fetch(ORIGIN+'/health',{signal:AbortSignal.timeout(10000)});
  if(!health.ok)throw Error('public_health_unavailable');
  const revision=(await health.json()).revision;
  if(revision!==expected)throw Error('production_revision_mismatch');
  const rows=[];
  for(let n=0;n<repeats;n++)for(const query of QUERIES){
    const start=performance.now();
    let observation;
    try{
      const response=await fetch(ORIGIN+'/api/search/stream?q='+encodeURIComponent(query),{
        headers:{accept:'text/event-stream'},signal:AbortSignal.timeout(18000)});
      observation=await collectFirstOfferEvents(response,{start});
    }catch(e){observation={status:null,firstValidMs:null,firstExactMs:null,
        finished:false,error:String(e?.name||'transport_failure').slice(0,90)}}
    const row={label:query,sample:n+1,...observation};
    rows.push(row);console.log('LIVE_FIRST_OFFER '+JSON.stringify(row));
    if(rows.length<repeats*QUERIES.length)await new Promise(r=>setTimeout(r,1250));
  }
  console.log('LIVE_FIRST_OFFER_SUMMARY '+JSON.stringify({sha:revision,...sampleSummary(rows)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(e=>{console.error('LIVE_TIMING_BLOCKED:',String(e.message||e));process.exitCode=1});
}
