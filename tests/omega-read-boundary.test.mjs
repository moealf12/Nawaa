import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Transport/repository doubles only: asserts actual server cache + SSE boundary.
// Prices/timestamps are simulated, official Jarir identity is source-derived.
test('canonical updates invalidate cached JSON and SSE prices at response boundary',()=>{
 const script=String.raw`
 import assert from 'node:assert/strict';
 import http from 'node:http';
 import {registerHooks} from 'node:module';
 Object.assign(process.env,{PORT:'0',NODE_ENV:'test',NAWAA_CANONICAL_INDEX_TEST:'1',NAWAA_OMEGA_INDEX_ONLY:'1',DATABASE_URL:'',SEARCH_STREAM_DEADLINE_MS:'500'});
 globalThis.latest=3049;
 const offer=()=>({title:'Sony PlayStation 5 Slim Console Blu-ray Edition 1 TB',sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-677770.html',sourceMeta:{productId:'677770'},merchant:'Jarir',merchantCountryCode:'SA',currency:'SAR',productPrice:globalThis.latest,observedAt:new Date().toISOString(),condition:'new',dataKind:'indexed'});
 globalThis.fixture=offer;
 registerHooks({resolve(s,c,next){if(s.endsWith('/omega-canonical-index.mjs')||s==='./omega-canonical-index.mjs')return {url:'data:text/javascript,'+encodeURIComponent('export async function guardedCanonicalSearch(){return {configured:true,offers:[globalThis.fixture()]}};export async function canonicalReadBoundary(offers){return offers.map(o=>({...o,productPrice:globalThis.latest}))};export async function isolatedCanonicalIndexOffers(){return {}}'),shortCircuit:true};return next(s,c)}});
 const get=(port,path)=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path},r=>{let b='';r.on('data',v=>b+=v);r.on('end',()=>resolve(b))}).on('error',reject));
 const listen=http.Server.prototype.listen;
 http.Server.prototype.listen=function(...args){this.once('listening',async()=>{try{
 const port=this.address().port,path='/api/search?q=PS5';
 const first=JSON.parse(await get(port,path));assert.equal(first.offers[0].productPrice,3049);
 globalThis.latest=3199;
 const second=JSON.parse(await get(port,path));assert.equal(second.offers[0].productPrice,3199,'cached JSON leaked superseded price');
 globalThis.latest=3299;
 const stream=await get(port,'/api/search/stream?q=PS5');
 const frames=stream.split(/\r?\n\r?\n/).filter(x=>x.startsWith('event: snapshot')).map(x=>JSON.parse(x.match(/^data: (.*)$/m)[1]));
 assert.ok(frames.length);assert.ok(frames.flatMap(x=>x.offers).every(x=>x.productPrice===3299),'cached SSE leaked superseded price');
 console.log('BOUNDARY_GREEN');process.exit(0);
 }catch(e){console.error(e);process.exit(1)}});return listen.apply(this,args)};
 await import('./server/server.mjs');`;
 const out=execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),timeout:15000,encoding:'utf8'});
 assert.match(out,/BOUNDARY_GREEN/);
});
