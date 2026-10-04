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
    import dns from 'node:dns/promises';
    dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
    process.env.PORT='0';
    globalThis.fetch=async url=>{
      if(String(url).startsWith('https://ac.cnstrc.com/')) return Response.json({response:{results:${fallback} && decodeURIComponent(new URL(url).pathname).includes('256gb')?[]:[{value:${JSON.stringify(title)},data:{id:'123',url:'apple-iphone-17-123.html',price:2000,metadata:{}}}]}});
      if(String(url).startsWith('https://search.unbxd.io/')) return Response.json({response:{products:[]}});
      if(String(url).startsWith('https://www.jarir.com/sa-en/apple-iphone-17-123.html')) return new Response('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:${JSON.stringify(title)},itemCondition:'renewed',offers:{price:2000,priceCurrency:'SAR',url:String(url)}})+'</script>',{headers:{'content-type':'text/html'}});
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

test('Amazon transport failures are visible in public API diagnostics',async()=>{
 const script=`
 import http from 'node:http';
 process.env.PORT='0';
 globalThis.fetch=async url=>{
  if(new URL(url).hostname==='www.amazon.sa')throw new Error('amazon_test_unavailable');
  if(String(url).startsWith('https://search.unbxd.io/'))return Response.json({response:{products:[]}});
  if(String(url).startsWith('https://ac.cnstrc.com/'))return Response.json({response:{results:[]}});
  return new Response('',{headers:{'content-type':'text/html'}});
 };
 const listen=http.Server.prototype.listen;
 http.Server.prototype.listen=function(...args){this.once('listening',()=>{
  http.get({host:'127.0.0.1',port:this.address().port,path:'/api/search?q=hp'},res=>{
   let body='';res.on('data',x=>body+=x);res.on('end',()=>{console.log('RESULT '+body);this.close(()=>process.exit(0));});
  });
 });return listen.apply(this,args);};
 await import('./server/server.mjs');`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),timeout:20000});
 const result=JSON.parse(stdout.split('\n').find(x=>x.startsWith('RESULT ')).slice(7));
 assert.ok(result.errors.some(e=>e.sourceId==='free-storefronts:amazon-sa'&&e.error.includes('amazon_test_unavailable')));
 assert.ok(result.providers.some(p=>p.sourceId==='free-storefronts:amazon-sa'&&p.ok===false));
});

test('cached recall retains provenance and is never written back as a fresh observation',async()=>{
 const cached={provider:'fixture',merchant:'Fixture',title:'HP Laptop',sourceUrl:'https://fixture.example/hp',productPrice:1000,currency:'SAR',originalProductPrice:1000,originalCurrency:'SAR',dataKind:'persisted',observedAt:'2026-01-01T00:00:00Z'};
 const fakePersistence=`export async function persistOffers(q,offers){globalThis.savedOffers=offers;return {saved:offers.length};} export async function searchPersistedOffers(){return {configured:true,offers:[${JSON.stringify(cached)}]};}`;
 const script=`
 import http from 'node:http';import {registerHooks} from 'node:module';
 registerHooks({resolve(specifier,context,next){if(specifier==='./persistence.mjs')return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(fakePersistence)}),shortCircuit:true};return next(specifier,context);}});
 process.env.PORT='0';
 globalThis.fetch=async url=>{
  if(String(url).startsWith('https://search.unbxd.io/'))return Response.json({response:{products:[]}});
  if(String(url).startsWith('https://ac.cnstrc.com/'))return Response.json({response:{results:[]}});
  return new Response('',{headers:{'content-type':'text/html'}});
 };
 const listen=http.Server.prototype.listen;
 http.Server.prototype.listen=function(...args){this.once('listening',()=>{
  http.get({host:'127.0.0.1',port:this.address().port,path:'/api/search?q=hp'},res=>{
   let body='';res.on('data',x=>body+=x);res.on('end',()=>{console.log('RESULT '+JSON.stringify({body:JSON.parse(body),saved:globalThis.savedOffers}));this.close(()=>process.exit(0));});
  });
 });return listen.apply(this,args);};await import('./server/server.mjs');`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),timeout:20000});
 const r=JSON.parse(stdout.split('\n').find(x=>x.startsWith('RESULT ')).slice(7));
 assert.equal(r.body.offers[0].dataKind,'persisted');
 assert.equal(r.body.offers[0].observedAt,'2026-01-01T00:00:00Z');
 assert.deepEqual(r.saved,[]);
});
