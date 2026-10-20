import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('SSE completes on deadline, keeps fast offers, and reports honest partial coverage',async()=>{
  const script=`
    import http from 'node:http';
    process.env.PORT='0';
    process.env.SEARCH_STREAM_DEADLINE_MS='300';
    globalThis.abortedNetworkCalls=0;
    globalThis.fetch=async (url,options={})=>{
      if(String(url).startsWith('https://search.unbxd.io/')){
        return Response.json({response:{numberOfProducts:1,products:[{
          id:'qa-extra-hp-laptop',name:'HP Pavilion Laptop 16GB RAM',
          currentPrice:2799,imageUrl:'https://www.extra.com/test-hp.jpg',
          featureEnBrandName:'HP',featureEnDeviceType:'Laptop',available:true
        }]}});
      }
      return new Promise((_,reject)=>{
        const signal=options.signal;
        if(!signal)throw Error('outbound_fetch_missing_abort_signal');
        const aborted=()=>{globalThis.abortedNetworkCalls++;reject(signal.reason||new Error('aborted'))};
        if(signal.aborted)aborted();
        else signal.addEventListener('abort',aborted,{once:true});
      });
    };
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once('listening',()=>{
        const start=Date.now();
        http.get({host:'127.0.0.1',port:this.address().port,path:'/api/search/stream?q=hp+laptop'},res=>{
          let body='';
          res.on('data',chunk=>body+=chunk);
          res.on('end',()=>{
            try{
              const events=body.split(/\\r?\\n\\r?\\n/).map(block=>{
                const name=block.match(/^event: (.+)$/m)?.[1];
                const data=block.match(/^data: (.+)$/m)?.[1];
                return name&&data?{name,data:JSON.parse(data)}:null;
              }).filter(Boolean);
              const snaps=events.filter(e=>e.name==='snapshot').map(e=>e.data);
              const final=snaps.at(-1)||{};
              console.log('RESULT '+JSON.stringify({
                status:res.statusCode,elapsedMs:Date.now()-start,snapshots:snaps.length,
                done:events.some(e=>e.name==='done'),firstOffers:snaps.find(s=>s.offers?.length)?.offers.length||0,
                finalOffers:final.offers||[],partial:final.coverage?.partial,
                complete:final.coverage?.complete,exceeded:final.coverage?.deadlineExceeded,
                pending:final.coverage?.providersPending,streamDeadlineMs:final.coverage?.streamDeadlineMs,
                timeoutErrors:final.errors?.filter(e=>e.error==='search_stream_deadline_exceeded').length||0,
                signedCursor:Boolean(final.nextCursor),
                abortedNetworkCalls:globalThis.abortedNetworkCalls
              }));
            }catch(e){console.log('ERROR '+e.stack);process.exitCode=1}
            this.close(()=>process.exit(process.exitCode||0));
          });
        }).on('error',e=>{console.log('ERROR '+e.message);this.close(()=>process.exit(1))});
      });
      return listen.apply(this,args);
    };
    await import('./server/server.mjs');
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:12000,maxBuffer:1024*1024,
  });
  const error=stdout.split('\n').find(x=>x.startsWith('ERROR '));
  assert.equal(error,undefined,error);
  const marker=stdout.split('\n').find(x=>x.startsWith('RESULT '));
  assert.ok(marker,stdout);
  const actual=JSON.parse(marker.slice(7));
  assert.equal(actual.status,200);
  assert.ok(actual.elapsedMs<2100,'SSE must not wait for hung source');
  assert.ok(actual.snapshots>=2,'progress and final snapshot required');
  assert.equal(actual.done,true);
  assert.ok(actual.firstOffers>=1,'fast provider must stream');
  assert.ok(actual.finalOffers.some(o=>o.provider==='extra-unbxd' &&
    o.title==='HP Pavilion Laptop 16GB RAM' && o.productPrice===2799),
    JSON.stringify(actual.finalOffers));
  assert.equal(actual.partial,true);
  assert.equal(actual.complete,false);
  assert.equal(actual.exceeded,true);
  assert.ok(actual.pending>=1);
  assert.equal(actual.streamDeadlineMs,300);
  assert.ok(actual.timeoutErrors>=1);
  assert.equal(actual.signedCursor,true);
  assert.ok(actual.abortedNetworkCalls>=1,'deadline must abort at least one in-flight network fetch');
});
