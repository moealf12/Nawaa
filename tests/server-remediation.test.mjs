import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Keep real API, orchestration, provider parser and matching. Only merchant
// transport is replaced; unknown provider requests return empty HTML.
for(const fallback of [false,true]) test('public API preserves requested renewed condition in '+(fallback?'fallback':'primary')+' provider search',async()=>{
  const query=fallback?'ايفون 17 256 جيجا مجدد':'ايفون 17 مجدد';
  const title=fallback?'Apple iPhone 17 256GB Renewed':'Apple iPhone 17 Renewed';
  const script=`
    import http from 'node:http';
    process.env.PORT='0';
    globalThis.fetch=async url=>{
      if(String(url).startsWith('https://ac.cnstrc.com/')) return Response.json({response:{results:${fallback} && decodeURIComponent(new URL(url).pathname).includes('256gb')?[]:[{value:${JSON.stringify(title)},data:{id:'123',url:'apple-iphone-17-123.html',price:2000,metadata:{}}}]}});
      if(String(url).startsWith('https://search.unbxd.io/')) return Response.json({response:{products:[]}});
      return new Response('',{headers:{'content-type':'text/html'}});
    };
    const originalListen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once('listening',async()=>{
        const server=this;
        try {
          const result=await new Promise((resolve,reject)=>{
            http.get({host:'127.0.0.1',port:server.address().port,path:'/api/search?q='+encodeURIComponent(${JSON.stringify(query)})},res=>{
              let body='';res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
            }).on('error',reject);
          });
          console.log('RESULT '+JSON.stringify(result));
        } catch {process.exitCode=1;}
        finally{server.close(()=>process.exit(process.exitCode || 0));}
      });
      return originalListen.apply(this,args);
    };
    await import('./server/server.mjs');
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),timeout:20000});
  const result=JSON.parse(stdout.split('\n').find(line=>line.startsWith('RESULT ')).slice(7));
  assert.equal(result.status,200);
  assert.deepEqual(result.body.offers.filter(x=>x.provider==='jarir-direct').map(x=>({title:x.title,exactMatch:x.exactMatch})),[{title,exactMatch:true}]
  );
  assert.equal(result.body.coverage.fallbackUsed,fallback);
});
