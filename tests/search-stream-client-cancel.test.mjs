import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('SSE shopper disconnect cancels in-flight merchant transport immediately',async()=>{
  const script=`
    import http from 'node:http';
    process.env.PORT='0';
    process.env.SEARCH_STREAM_DEADLINE_MS='3000';
    process.env.DATABASE_URL='';
    let networkAborts=0,started=0;
    globalThis.fetch=async (url,options={})=>{
      if(String(url).startsWith('https://search.unbxd.io/'))return Response.json({
        response:{products:[{
          id:'qa-fast-hp-laptop',name:'HP Pavilion Laptop 16GB RAM',
          currentPrice:2799,featureEnBrandName:'HP',available:true
        }]}
      });
      started++;
      const signal=options.signal;
      if(!signal)throw Error('missing_abort_signal');
      return new Promise((_,reject)=>{
        const abort=()=>{networkAborts++;reject(signal.reason||new Error('aborted'))};
        if(signal.aborted)abort();
        else signal.addEventListener('abort',abort,{once:true});
      });
    };
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once('listening',()=>{
        const server=this,begin=Date.now(),port=server.address().port;
        const req=http.get({host:'127.0.0.1',port,path:'/api/search/stream?q=hp+laptop'},res=>{
          let data='';
          res.on('data',chunk=>{
            data+=chunk;
            if(data.includes('event: snapshot')&&data.includes('HP Pavilion Laptop')){
              req.destroy();
              setTimeout(()=>{
                console.log('RESULT '+JSON.stringify({
                  elapsedMs:Date.now()-begin,started,networkAborts,
                  sawFastOffer:true,hasDone:data.includes('event: done')
                }));
                server.close(()=>process.exit(0));
              },150);
            }
          });
          res.on('error',()=>{});
        });
        req.on('error',()=>{});
      });
      return listen.apply(this,args);
    };
    await import('./server/server.mjs');
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:11000,maxBuffer:1024*1024
  });
  const line=stdout.split('\n').find(x=>x.startsWith('RESULT '));
  assert.ok(line,stdout);
  const result=JSON.parse(line.slice(7));
  assert.equal(result.sawFastOffer,true);
  assert.ok(result.started>=1,'must have pending outbound merchant work');
  assert.ok(result.networkAborts>=1,'client disconnect must abort upstream fetch');
  assert.ok(result.elapsedMs<2500,'abort should precede the configured SSE deadline');
  assert.equal(result.hasDone,false,'disconnected clients cannot receive completion');
});
