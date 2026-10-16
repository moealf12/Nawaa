import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// A dependency gate, not a wall-clock speed threshold: page two only succeeds
// after the HTTP client sees page one. Restoring the old barrier breaks this test.
for(const failure of [false,true])test(`SSE publishes Jarir before page-two settlement; later failure=${failure}`,async()=>{
  const script=`
    import http from 'node:http';
    process.env.PORT='0';process.env.DATABASE_URL='';process.env.MEILI_HOST='';
    let release,pageTwoSettled=false,early=false,earlyCoverage=null,firstMs=null;
    const gate=new Promise(r=>release=r);
    const row=id=>({value:'Sony PlayStation 5 Console 1TB',data:{id:String(id),url:'sony-playstation-5-'+id+'.html',price:2000+id,image_url:'https://www.jarir.com/ps5.jpg'}});
    globalThis.fetch=async(url,options={})=>{
      const u=new URL(url);
      if(u.hostname==='ac.cnstrc.com'){
        if(u.searchParams.get('page')==='1')return Response.json({response:{results:Array.from({length:48},()=>row(1))}});
        await Promise.race([gate,new Promise((_,reject)=>{
          const abort=()=>{pageTwoSettled=true;reject(options.signal.reason)};
          if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});
        })]);pageTwoSettled=true;
        return ${failure} ? new Response('',{status:503}) : Response.json({response:{results:[row(49)]}});
      }
      if(u.hostname==='search.unbxd.io'){
        await gate;return Response.json({response:{products:[{id:'other-console',name:'Sony PlayStation 5 Console 1TB',currentPrice:2599,available:true}]}});
      }
      return new Response('',{status:200,headers:{'content-type':'text/html'}});
    };
    const listen=http.Server.prototype.listen;
    http.Server.prototype.listen=function(...args){
      this.once('listening',()=>{
        const server=this,start=performance.now();let buffer='',last={},done=false;
        http.get({host:'127.0.0.1',port:this.address().port,path:'/api/search/stream?q=PS5'},res=>{
          res.on('data',part=>{
            buffer+=part;let end;
            while((end=buffer.indexOf('\\n\\n'))>=0){
              const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
              if(block.startsWith('event: snapshot')){
                last=JSON.parse(block.match(/^data: (.*)$/m)[1]);
                if(firstMs===null && last.offers?.some(o=>o.merchant==='Jarir')){
                  firstMs=Math.round(performance.now()-start);early=!pageTwoSettled;earlyCoverage=last.coverage;release();
                }
              }
              if(block.startsWith('event: done'))done=true;
            }
          });
          res.on('end',()=>{
            console.log('RESULT '+JSON.stringify({firstMs,early,earlyCoverage,done,last}));
            server.close(()=>process.exit(0));
          });
        }).on('error',e=>{console.error(e);process.exit(1)});
      });
      return listen.apply(this,args);
    };
    await import('./server/server.mjs');
  `;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{
    cwd:new URL('..',import.meta.url),timeout:15000,maxBuffer:4*1024*1024,
  });
  const result=JSON.parse(stdout.split('\n').find(l=>l.startsWith('RESULT ')).slice(7));
  assert.equal(result.early,true,'ready Jarir offers must reach HTTP before the second page settles');
  assert.equal(result.earlyCoverage.partial,true);
  assert.equal(result.earlyCoverage.complete,false);
  assert.ok(result.earlyCoverage.providersPending>0,'early publication must not claim provider completion');
  assert.equal(result.done,true);
  assert.ok(result.last.offers.some(o=>o.merchant==='eXtra'),'later merchant remains visible');
  assert.ok(result.last.offers.some(o=>o.merchant==='Jarir' && o.sourceMeta.productId==='1'));
  assert.equal(new Set(result.last.offers.map(o=>o.sourceUrl)).size,result.last.offers.length,'progress and final results are deduplicated');
  if(failure){
    assert.ok(result.last.errors.some(e=>e.sourceId==='jarir-direct' && /503/.test(e.error)));
    assert.equal(result.last.coverage.partial,true);assert.equal(result.last.coverage.complete,false);
  }else assert.ok(result.last.offers.some(o=>o.merchant==='Jarir' && o.sourceMeta.productId==='49'),'second page is retained');
  console.log('JARIR_FIRST_OFFER_REGRESSION '+JSON.stringify({failure,firstOfferMs:result.firstMs}));
});
