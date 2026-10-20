import test from 'node:test';
import assert from 'node:assert/strict';
import {searchJarir} from '../server/providers/jarir.mjs';
const item=(id,extra={})=>({value:'Sony PlayStation 5 Console 1TB',data:{id:String(id),url:`sony-playstation-5-${id}.html`,price:2200+id,image_url:'https://www.jarir.com/ps5.jpg',...extra}});
const first=Array.from({length:48},(_,i)=>item(i+1));
first[0]={value:'Sony PlayStation 5 Disc Drive',data:{id:'1',url:'sony-disc-drive.html',price:399}};
first[1]=item(2,{price:-1});
const payload=results=>Response.json({response:{results}});

test('Jarir emits classified valid page-one offers before waiting for page two, preserving final recall and evidence',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  let release,started;const gate=new Promise(r=>{release=r}),pageTwo=new Promise(r=>{started=r});
  const chunks=[];
  globalThis.fetch=async url=>{
    if(new URL(url).searchParams.get('page')==='1')return payload(first);
    started();await gate;return payload([item(49)]);
  };
  const pending=searchJarir('PS5',96,'PS5',{onOffers:offers=>chunks.push(offers)});
  try {
    await pageTwo;
    assert.equal(chunks.length,1,'page one must be observable while page two is unresolved');
    assert.equal(chunks[0].length,47,'invalid prices must never be published');
    assert.equal(chunks[0].find(o=>o.sourceMeta.productId==='1').exactMatch,false,'disc drive is not an exact console');
    assert.ok(chunks[0].every(o=>o.merchant==='Jarir' && o.productPrice>0 && o.observedAt && o.sourceMeta.parsedFrom==='jarir-constructor-search'));
  }finally{release();}
  const result=await pending;
  assert.equal(result.offers.length,48,'later page recall is retained');
  for(const offer of chunks[0])assert.deepEqual(result.offers.find(o=>o.sourceUrl===offer.sourceUrl),offer,'early and final evidence must be identical');
  assert.equal(result.errors.length,0);
});

test('Jarir keeps early offers and reports a later page failure',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});const chunks=[];
  globalThis.fetch=async url=>new URL(url).searchParams.get('page')==='1'?payload(first):new Response('',{status:503});
  const result=await searchJarir('PS5',96,'PS5',{onOffers:offers=>chunks.push(offers)});
  assert.equal(chunks.length,1);
  assert.equal(result.offers.length,47);
  assert.equal(result.diagnostics.pagination.partial,true);
  assert.match(result.errors[0].error,/503/);
});

test('abort after an early Jarir page prevents further transport and callbacks',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
  const controller=new AbortController();let requests=0,chunks=0;
  globalThis.fetch=async()=>{requests++;return payload(first)};
  await assert.rejects(searchJarir('PS5',96,'PS5',{signal:controller.signal,onOffers:()=>{chunks++;controller.abort(new Error('shopper_left'))}}),/shopper_left/);
  assert.equal(chunks,1);assert.equal(requests,1);
});
