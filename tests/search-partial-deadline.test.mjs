import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('JSON search retains a fast genuine offer when slower sources overrun the deadline',async()=>{
  const script = `
    import http from 'node:http';
    process.env.PORT='0';
    process.env.SEARCH_REQUEST_DEADLINE_MS='220';
    globalThis.fetch=async url=>{
      if(String(url).startsWith('https://search.unbxd.io/')){
        return Response.json({response:{numberOfProducts:1,products:[{
          id:'qa-extra-hp-laptop',name:'HP Pavilion Laptop 16GB RAM',
          currentPrice:2799,imageUrl:'https://www.extra.com/test-hp.jpg',
          featureEnBrandName:'HP',featureEnDeviceType:'Laptop',available:true
        }]}});
      }
      return new Promise(()=>{});
    };
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once('listening',()=>{
        const start=Date.now();
        http.get({host:'127.0.0.1',port:this.address().port,path:'/api/search?q=hp+laptop'},res=>{
          let text='';
          res.on('data',part=>text+=part);
          res.on('end',()=>{
            const body=JSON.parse(text);
            console.log('RESULT '+JSON.stringify({
              status:res.statusCode,elapsed:Date.now()-start,
              offers:body.offers?.map(o=>({provider:o.provider,price:o.productPrice,title:o.title})),
              deadlineExceeded:body.coverage?.deadlineExceeded,
              deadlineErrors:body.errors?.filter(e=>e.error==='search_deadline_exceeded').length,
            }));
            this.close(()=>process.exit(0));
          });
        });
      });
      return listen.apply(this,args);
    };
    await import('./server/server.mjs');
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:12000,maxBuffer:1024*1024,
  });
  const marker=stdout.split('\n').find(line=>line.startsWith('RESULT '));
  assert.ok(marker,stdout);
  const actual=JSON.parse(marker.slice(7));
  assert.equal(actual.status,200);
  assert.ok(actual.elapsed<1750,'the deadline must remain bounded');
  assert.equal(actual.deadlineExceeded,true);
  assert.ok(actual.deadlineErrors>=1);
  assert.ok(actual.offers.some(o=>o.provider==='extra-unbxd' && o.price===2799 &&
    o.title==='HP Pavilion Laptop 16GB RAM'),JSON.stringify(actual));
});
