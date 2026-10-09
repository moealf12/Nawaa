import test from "node:test";
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {CERTIFIED_PILOT_SOURCES,certifiedPilotSource} from "../src/certified-pilot.mjs";
import {configuredFreeStorefronts} from "../server/providers/free-storefronts.mjs";

test("pilot manifest contains precisely 15 live-certified sources",()=>{
 const expected=["aliexpress-cn","ikea-sa","asos-global","amazon-sa","newegg-global",
  "bestbuy-us","namshi-sa","centrepoint-sa","maxfashion-sa","decathlon-sa","niceone-sa",
  "goldenscent-sa","mumzworld-sa","lookfantastic-global","cultbeauty-global"];
 assert.deepEqual(CERTIFIED_PILOT_SOURCES.map(x=>x.id),expected);
 const enabled=new Set(configuredFreeStorefronts().map(s=>s.id));
 assert.ok(CERTIFIED_PILOT_SOURCES.every(x=>enabled.has(x.id)));
 assert.equal(certifiedPilotSource("noon-ae"),null);
 assert.equal(certifiedPilotSource("virgin-ae"),null);
 assert.ok(CERTIFIED_PILOT_SOURCES.every(x=>x.sampleQueries.length===2));
});

test("local live-site pilot serves only allowlisted merchant offers, with image and verified SAR price",async()=>{
 const script=String.raw`
 import http from 'node:http';
 process.env.PORT='0';
 process.env.NAWAA_ENABLE_CERTIFIED_PILOT='1';
 globalThis.fetch=async url=>{
  if(String(url).startsWith('https://www.goldenscent.com/en/c/perfumes'))
   return new Response('<html><script type="application/ld+json">'+JSON.stringify({
      '@type':'Product',name:'Roberto Cavalli Paradiso Perfume for Women',
      url:'https://www.goldenscent.com/en/p/roberto-cavalli-paradiso-eau-de-parfum-for-women',
      image:'https://images.example.org/real-perfume.jpg',
      offers:{price:118,priceCurrency:'SAR'},
   })+'</script></html>',{headers:{'content-type':'text/html'}});
  return new Response('<html></html>',{headers:{'content-type':'text/html'}});
 };
 function request(port,path){
  return new Promise((resolve,reject)=>{
   http.get({host:'127.0.0.1',port,path},res=>{
    let value='';res.on('data',chunk=>value+=chunk);
    res.on('end',()=>resolve({status:res.statusCode,body:res.headers['content-type']?.includes('application/json')?JSON.parse(value):value}));
   }).on('error',reject);
  });
 }
 const originalListen=http.Server.prototype.listen;
 http.Server.prototype.listen=function(...args){
  this.once('listening',async()=>{
   try{
    const port=this.address().port;
    const manifest=await request(port,'/api/pilot/sources');
    const blocked=await request(port,'/api/pilot/source-search?store=noon-ae&q=iphone');
    const real=await request(port,'/api/pilot/source-search?store=goldenscent-sa&q=perfume');
    const page=await request(port,'/pilot.html');
    console.log('PILOT_RESULTS '+JSON.stringify({manifest,blocked,real,pageStatus:page.status,pageHasUI:page.body.includes('اختبار المصادر المعتمدة')}));
   }catch(error){console.error(error);process.exitCode=1;}
   finally{this.close(()=>process.exit(process.exitCode||0));}
  });return originalListen.apply(this,args);
 };
 await import('./server/server.mjs');
 `;
 const {stdout}=await promisify(execFile)(process.execPath,["--input-type=module","-e",script],{cwd:new URL("..",import.meta.url),timeout:18000});
 const result=JSON.parse(stdout.split("\n").find(x=>x.startsWith("PILOT_RESULTS ")).slice(14));
 assert.equal(result.manifest.status,200);
 assert.equal(result.manifest.body.certifiedCount,15);
 assert.equal(result.manifest.body.sources.length,15);
 assert.equal(result.blocked.status,400);
 assert.equal(result.real.status,200,JSON.stringify(result.real.body));
 assert.equal(result.real.body.offers.length,1,JSON.stringify(result.real.body));
 assert.equal(result.real.body.offers[0].productPrice,118);
 assert.ok(result.real.body.offers[0].image.startsWith("https://"));
 assert.equal(result.pageStatus,200);
 assert.equal(result.pageHasUI,true);
});

test("pilot API remains inaccessible unless explicitly enabled",async()=>{
 const script=String.raw`
 import http from 'node:http';
 process.env.PORT='0';
 delete process.env.NAWAA_ENABLE_CERTIFIED_PILOT;
 const old=http.Server.prototype.listen;
 http.Server.prototype.listen=function(...args){
  this.once('listening',()=>{
   http.get({host:'127.0.0.1',port:this.address().port,path:'/api/pilot/sources'},res=>{
    let s='';res.on('data',x=>s+=x);res.on('end',()=>{console.log('RESULT '+JSON.stringify({status:res.statusCode,body:JSON.parse(s)}));this.close(()=>process.exit(0));});
   });
  });return old.apply(this,args);
 };
 await import('./server/server.mjs');
 `;
 const {stdout}=await promisify(execFile)(process.execPath,["--input-type=module","-e",script],{cwd:new URL("..",import.meta.url),timeout:18000});
 const result=JSON.parse(stdout.split("\n").find(x=>x.startsWith("RESULT ")).slice(7));
 assert.equal(result.status,404);
 assert.equal(result.body.error,"pilot_disabled");
});
