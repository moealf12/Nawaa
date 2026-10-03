import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import threads from 'node:worker_threads';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {createInternalAuditHandler,runAuditWorker} from '../server/internal-audit.mjs';

const source={id:'extra',name:'eXtra',adapter:'extra-unbxd',status:'configured'};
const token='a'.repeat(43);
async function fixture(options={},check) {
  const handler=createInternalAuditHandler({token,expiresAt:new Date(Date.now()+60000).toISOString(),revision:'test-sha',sources:()=>[source],run:async()=>({status:'NO_RESULTS'}),...options});
  const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/internal/source-audit`;
  const call=(body={sourceId:'extra',query:'iphone',expected:'results'},headers={})=>fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  try {await check(call,url);}finally {await new Promise(r=>server.close(r));}
}
test('internal audit denies missing or wrong credentials without running providers',async()=>{
  await fixture({run:()=>{throw Error('must not run');}},async call=>{
    for(const authorization of ['',`Bearer ${'b'.repeat(43)}`]) {
      const r=await call(undefined,{authorization});assert.equal(r.status,401);
      assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(r.headers.get('cache-control'),'no-store');
    }
  });
});
test('expired, absent or short credentials leave the endpoint disabled',async()=>{
  for(const opts of [{token:''},{token:'short'},{expiresAt:new Date(0).toISOString()},{expiresAt:'bad'}]) {
    await fixture(opts,async call=>assert.equal((await call()).status,404));
  }
});
test('browser origins, non-POST and invalid bounded JSON are rejected',async()=>{
  await fixture({},async(call,url)=>{
    assert.equal((await call(undefined,{origin:'https://moealf12.github.io'})).status,403);
    assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token}`}})).status,405);
    for(const body of ['{',{}, {sourceId:'extra',query:'a'}, {sourceId:'extra',query:'x'.repeat(181)}, {sourceId:'extra',query:'iphone',expected:'anything'}, {sourceId:'extra',query:'iphone',url:'https://example.com'}]) assert.equal((await call(body)).status,400);
    assert.equal((await call('x'.repeat(2049))).status,413);
    assert.equal((await call(undefined,{'content-type':'text/plain'})).status,415);
    assert.equal((await call({sourceId:'unknown',query:'iphone'})).status,400);
  });
});
test('same-source overlap and excess concurrency are rejected before provider work',async()=>{
  let release;const pending=new Promise(r=>{release=r;});let entered=0;
  const sources=()=>[source,{...source,id:'jarir'},{...source,id:'third'}];
  await fixture({sources,run:async()=>{entered++;await pending;return {status:'NO_RESULTS'};}},async call=>{
    const first=call();while(entered<1) await new Promise(r=>setTimeout(r,2));
    assert.equal((await call()).status,409);
    const second=call({sourceId:'jarir',query:'iphone'});while(entered<2) await new Promise(r=>setTimeout(r,2));
    assert.equal((await call({sourceId:'third',query:'iphone'})).status,429);
    release();assert.equal((await first).status,200);assert.equal((await second).status,200);
    assert.equal((await call()).status,200);
  });
});
test('service revision and environment are authoritative; raw errors never leave handler',async()=>{
  await fixture({run:async args=>({status:'NO_RESULTS',revision:args.revision})},async call=>{
    const r=await call();const d=await r.json();assert.equal(d.revision,'test-sha');assert.equal(d.executionEnvironment,'render-service-worker');assert.equal(d.cachePolicy,'direct-provider-request');
  });
  await fixture({run:async()=>{throw Error('secret-token');}},async call=>{
    const r=await call();assert.equal(r.status,503);assert.ok(!(await r.text()).includes('secret-token'));
  });
});
test('worker runs an isolated unconnected source and terminates cleanly',async()=>{
  const r=await runAuditWorker({source:{id:'currys',name:'Currys',status:'candidate'},query:'laptop',expected:'results',revision:'test-sha',timeoutMs:100});
  assert.equal(r.status,'UNCONNECTED');assert.equal(r.revision,'test-sha');assert.equal(r.verifiedSource,false);
});
test('worker watchdog preserves elapsed time and reports an unknown worker phase',async()=>{
 const Original=threads.Worker;let terminated=false;
 class StalledWorker extends EventEmitter {terminate(){terminated=true;return Promise.resolve();}}
 threads.Worker=StalledWorker;syncBuiltinESMExports();const started=Date.now();
 try {
  const r=await runAuditWorker({source,query:'iphone',expected:'results',revision:'test-sha',timeoutMs:100});
  assert.equal(r.status,'TIMEOUT');assert.ok(r.durationMs>=3000);assert.ok(Date.parse(r.observedAt)-started<100);
  assert.equal(r.failureStage,'worker_watchdog');assert.equal(r.counts.raw,null);assert.equal(terminated,true);
 }finally{threads.Worker=Original;syncBuiltinESMExports();}
});
