import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('provider failures retain honest partial SSE and JSON coverage without missing genuine offers',async()=>{
  const script = `
    import http from 'node:http';
    process.env.PORT='0';
    process.env.DATABASE_URL='';
    process.env.SEARCH_STREAM_DEADLINE_MS='8000';
    process.env.SEARCH_REQUEST_DEADLINE_MS='2500';
    globalThis.fetch=async url=>{
      if(String(url).startsWith('https://search.unbxd.io/'))return Response.json({
        response:{products:[{
          id:'qa-coverage-extra-hp',name:'HP Pavilion Laptop 16GB RAM',
          currentPrice:2799,imageUrl:'https://www.extra.com/test-hp.jpg',
          featureEnBrandName:'HP',featureEnDeviceType:'Laptop',available:true
        }]}
      });
      if(String(url).startsWith('https://ac.cnstrc.com/'))throw Error('qa_injected_jarir_failure');
      return new Response('',{status:200,headers:{'content-type':'text/html'}});
    };
    const get=(port,path)=>new Promise((resolve,reject)=>{
      http.get({host:'127.0.0.1',port,path},response=>{
        let body='';
        response.on('data',part=>body+=part);
        response.on('end',()=>resolve({status:response.statusCode,body}));
      }).on('error',reject);
    });
    const start=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once('listening',async()=>{
        try{
          const port=this.address().port;
          const sse=await get(port,'/api/search/stream?q=hp+laptop');
          const events=sse.body.split('\\n\\n')
            .filter(block=>block.startsWith('event: snapshot\\n'))
            .map(block=>JSON.parse(block.match(/^data: (.*)$/m)[1]));
          const last=events.at(-1);
          const json=await get(port,'/api/search?q=hp+laptop');
          const parsed=JSON.parse(json.body);
          console.log('RESULT '+JSON.stringify({
            streamStatus:sse.status,done:sse.body.includes('event: done'),
            streamPartial:last?.coverage?.partial,streamComplete:last?.coverage?.complete,
            streamDeadline:last?.coverage?.deadlineExceeded,streamPending:last?.coverage?.providersPending,
            streamErrors:last?.errors?.length||0,
            streamOffer:last?.offers?.some(o=>o.provider==='extra-unbxd'&&o.productPrice===2799),
            jsonStatus:json.status,jsonPartial:parsed.coverage?.partial,
            jsonComplete:parsed.coverage?.complete,jsonErrors:parsed.errors?.length||0,
          }));
        }catch(error){console.log('FAIL '+error.stack);process.exitCode=1;}
        finally{this.close(()=>process.exit(process.exitCode||0));}
      });
      return start.apply(this,args);
    };
    await import('./server/server.mjs');
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:18000,maxBuffer:2*1024*1024,
  });
  const failure=stdout.split('\n').find(x=>x.startsWith('FAIL '));
  assert.equal(failure,undefined,failure);
  const marker=stdout.split('\n').find(x=>x.startsWith('RESULT '));
  assert.ok(marker,stdout);
  const actual=JSON.parse(marker.slice(7));
  assert.equal(actual.streamStatus,200);
  assert.equal(actual.done,true);
  assert.equal(actual.streamDeadline,false,'fast completed failures are not deadline exhaustion');
  assert.equal(actual.streamPending,0);
  assert.ok(actual.streamErrors>=1,'upstream failures must not be dropped');
  assert.equal(actual.streamOffer,true,'completed valid offers survive partial failure');
  assert.equal(actual.streamPartial,true);
  assert.equal(actual.streamComplete,false);
  assert.equal(actual.jsonStatus,200);
  assert.ok(actual.jsonErrors>=1);
  assert.equal(actual.jsonPartial,true);
  assert.equal(actual.jsonComplete,false);
});
