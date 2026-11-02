import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchCache} from '../server/search-cache.mjs';

// R06-A: virtual-clock tests. These do not claim fresh merchant prices.
// The hard stale deadline is exclusive; a provider failure supplies no new price evidence.
test('R06-A: at exact staleTtl an expired quote is not resurrected; later retry may recover',async()=>{
  let now=0,calls=0;
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1)return {offers:[{title:'Phone',productPrice:1799,availability:'in_stock',exactMatch:true}],errors:[]};
    if(calls===2)return {offers:[],errors:[{provider:'jarir',error:'timeout'}]};
    return {offers:[{title:'Phone',productPrice:1699,availability:'unknown',exactMatch:true}],errors:[]};
  },{ttl:10,staleTtl:20,now:()=>now});
  assert.equal((await cache('phone')).offers[0].productPrice,1799);
  now=20;
  const expired=await cache('phone');
  assert.equal(calls,2);
  assert.deepEqual(expired.offers,[]);
  assert.equal(expired.errors[0].error,'timeout');
  assert.equal(expired.cache.mode,'miss');
  assert.equal(cache.peek('phone'),null);
  assert.equal(cache.stats().entries,0);
  now=21;
  const recovered=await cache('phone');
  assert.equal(calls,3);
  assert.equal(recovered.offers[0].productPrice,1699);
  assert.equal(recovered.cache.mode,'miss');
});

test('R06-A: beyond staleTtl, failed refresh never re-publishes old in-stock exact-match offer',async()=>{
  let now=0,calls=0;
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1)return {offers:[{title:'PS5',productPrice:2299,availability:'in_stock',exactMatch:true}],errors:[]};
    return {offers:[],errors:[{provider:'extra',error:'HTTP 503'}]};
  },{ttl:10,staleTtl:20,now:()=>now});
  await cache('ps5');
  now=25;
  const result=await cache('ps5');
  assert.equal(result.offers.length,0);
  assert.equal(result.errors[0].error,'HTTP 503');
  assert.equal(result.cache.mode,'miss');
  assert.equal(cache.stats().entries,0);
});

test('R06-A: an in-flight stale refresh crossing the hard deadline cannot restore expired price',async()=>{
  let now=0,calls=0,release,started;
  const startedPromise=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1)return {offers:[{title:'Phone',productPrice:1999}],errors:[]};
    started();
    await gate;
    return {offers:[],errors:[{provider:'extra',error:'unreachable'}]};
  },{ttl:10,staleTtl:20,now:()=>now});
  await cache('phone');
  now=15;
  const eligibleStale=await cache('phone');
  assert.equal(eligibleStale.cache.mode,'stale');
  assert.equal(eligibleStale.offers[0].productPrice,1999);
  await startedPromise;
  now=20;
  const waiting=cache('phone');
  release();
  const expired=await waiting;
  assert.equal(calls,2,'in-flight refresh must be coalesced');
  assert.deepEqual(expired.offers,[]);
  assert.equal(expired.errors[0].error,'unreachable');
  assert.equal(expired.cache.mode,'miss');
  assert.equal(cache.peek('phone'),null);
});

test('R06-A: fifty concurrent clients at expiry share one failed refresh without expired fallback',async()=>{
  let now=0,calls=0,release,started;
  const gate=new Promise(resolve=>{release=resolve;});
  const startedPromise=new Promise(resolve=>{started=resolve;});
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1)return {offers:[{title:'iPhone',productPrice:3999}],errors:[]};
    started();
    await gate;
    return {offers:[],errors:[{provider:'jarir',error:'network down'}]};
  },{ttl:10,staleTtl:20,now:()=>now});
  await cache('iphone');
  now=20;
  const requests=Array.from({length:50},()=>cache('iphone'));
  await startedPromise;
  release();
  const responses=await Promise.all(requests);
  assert.equal(calls,2);
  for(const r of responses){
    assert.deepEqual(r.offers,[]);
    assert.equal(r.errors[0].error,'network down');
    assert.equal(r.cache.mode,'miss');
  }
});

test('R06-A: valid offers from successful providers survive partial failure but are not cached as complete',async()=>{
  let now=0,calls=0;
  const cache=createSearchCache(async()=>{
    calls++;
    if(calls===1)return {offers:[{merchant:'Jarir',title:'Phone',productPrice:2300}],errors:[]};
    if(calls===2)return {offers:[{merchant:'eXtra',title:'Phone',productPrice:2250}],
      errors:[{provider:'jarir',error:'timeout'}],
      coverage:{complete:false,partial:true,deadlineExceeded:false,providersPending:0,sourceFailures:{errorsReported:1}}};
    return {offers:[{merchant:'Jarir',title:'Phone',productPrice:2200}],errors:[]};
  },{ttl:10,staleTtl:20,now:()=>now});
  await cache('phone');
  now=20;
  const partial=await cache('phone');
  assert.equal(calls,2);
  assert.deepEqual(partial.offers.map(x=>x.merchant),['eXtra']);
  assert.equal(partial.errors.length,1);
  assert.equal(partial.cache.completeness,'partial');
  assert.equal(cache.peek('phone'),null);
  now=21;
  assert.equal((await cache('phone')).offers[0].productPrice,2200);
  assert.equal(calls,3);
});

test('R06-A: within the permitted stale interval, eligible offers are served as stale and refresh runs',async()=>{
  let now=0,calls=0;
  const cache=createSearchCache(async()=>{
    calls++;
    return calls===1?{offers:[{title:'Phone',productPrice:1900}],errors:[]}:
      {offers:[],errors:[{provider:'jarir',error:'temporary'}]};
  },{ttl:10,staleTtl:20,now:()=>now});
  await cache('phone');
  now=15;
  const stale=await cache('phone');
  assert.equal(stale.offers[0].productPrice,1900);
  assert.equal(stale.cache.mode,'stale');
  await cache.refresh('phone');
  assert.equal(calls,2);
  now=20;
  assert.equal(cache.peek('phone'),null);
});
