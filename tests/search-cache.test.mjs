import test from 'node:test';
import assert from 'node:assert/strict';

test('repeated and concurrent queries reuse fresh results without sharing mutable offers', async () => {
  const mod = await import('../server/search-cache.mjs').catch(() => ({}));
  assert.equal(typeof mod.createSearchCache, 'function');
  let now = 0, calls = 0;
  const search = mod.createSearchCache(async () => { calls++; return {offers:[{title:'phone'}],errors:[]}; }, {ttl:100, maxEntries:2, now:()=>now});
  const [a,b] = await Promise.all([search('iphone 17'),search('iphone 17')]);
  a.offers.length = 0;
  assert.equal(b.offers.length,1);
  assert.equal(calls,1);
  assert.equal((await search('iphone 17')).offers.length,1);
  now=101;await search('iphone 17');assert.equal(calls,2);
  await search('b');await search('c');await search('iphone 17');assert.equal(calls,5);
});

test('partial source failures are retried rather than cached', async () => {
  const mod = await import('../server/search-cache.mjs').catch(() => ({}));
  assert.equal(typeof mod.createSearchCache,'function');
  let calls=0;
  const search=mod.createSearchCache(async()=>{calls++;return {offers:[],errors:[{provider:'jarir'}]};});
  await search('iphone');await search('iphone');assert.equal(calls,2);
});


test('catalog invalidation during an in-flight search refreshes instead of returning empty', async () => {
  const { createSearchCache } = await import('../server/search-cache.mjs');
  let release;
  let calls=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const cached=createSearchCache(async()=>{
    calls++;
    if(calls===1) await gate;
    return {offers:[{title:'HP Laptop',call:calls}],errors:[]};
  });
  const pending=cached('hp');
  await new Promise(resolve=>setTimeout(resolve,0));
  cached.clear();
  release();
  const result=await pending;
  assert.equal(calls,2);
  assert.equal(result.offers.length,1);
  assert.equal(result.offers[0].call,2);
  assert.equal(result.errors.length,0);
});


test('stale-but-eligible results survive a transient empty refresh', async () => {
  const { createSearchCache } = await import('../server/search-cache.mjs');
  let now=0,calls=0;
  const cached=createSearchCache(async()=>{
    calls++;
    return calls===1 ? {offers:[{title:'iPhone 17'}],errors:[]} : {offers:[],errors:[{provider:'jarir',error:'temporary provider timeout'}]};
  },{ttl:10,staleTtl:20,now:()=>now});
  assert.equal((await cached('iphone')).offers.length,1);
  now=15;
  const rescued=await cached('iphone',{allowStale:false});
  assert.equal(calls,2);
  assert.equal(rescued.offers.length,1);
  assert.equal(rescued.offers[0].title,'iPhone 17');
  assert.equal(rescued.cache.mode,'stale-if-error');
  assert.equal(rescued.cache.stale,true);
});

test('expired price evidence is rejected at the hard stale deadline and can refresh later',async()=>{
  const { createSearchCache } = await import('../server/search-cache.mjs');
  let now=0,calls=0;
  const cached=createSearchCache(async()=>{
    calls++;
    if(calls===1)return {offers:[{title:'iPhone 17',productPrice:1799,observedAt:'2026-01-01T00:00:00Z'}],errors:[]};
    if(calls===2)return {offers:[],errors:[{provider:'jarir',error:'timeout'}]};
    return {offers:[{title:'iPhone 17',productPrice:1699,observedAt:'2026-10-14T00:00:00Z'}],errors:[]};
  },{ttl:10,staleTtl:20,now:()=>now});
  assert.equal((await cached('iphone')).offers[0].productPrice,1799);
  now=20; // age exactly equals the hard expiry: never re-serve the stale price
  const expired=await cached('iphone');
  assert.equal(calls,2);
  assert.deepEqual(expired.offers,[]);
  assert.equal(expired.errors[0].error,'timeout');
  assert.equal(expired.cache.mode,'miss');
  assert.equal(cached.peek('iphone'),null);
  assert.equal(cached.stats().entries,0);
  now=21;
  const recovered=await cached('iphone');
  assert.equal(calls,3);
  assert.equal(recovered.offers[0].productPrice,1699);
  assert.equal(recovered.cache.mode,'miss');
});

test('refresh crossing the stale deadline never reintroduces expired pricing',async()=>{
  const { createSearchCache } = await import('../server/search-cache.mjs');
  let now=0,calls=0,release,started;
  const startedPromise=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const cached=createSearchCache(async()=>{
    calls++;
    if(calls===1)return {offers:[{title:'Phone',productPrice:1999}],errors:[]};
    started();
    await gate;
    return {offers:[],errors:[{provider:'extra',error:'source unavailable'}]};
  },{ttl:10,staleTtl:20,now:()=>now});
  assert.equal((await cached('phone')).offers[0].productPrice,1999);
  now=15;
  const refreshing=cached('phone',{allowStale:false});
  await startedPromise;
  now=20;
  release();
  const result=await refreshing;
  assert.equal(calls,2);
  assert.deepEqual(result.offers,[]);
  assert.equal(result.errors[0].error,'source unavailable');
  assert.equal(result.cache.mode,'miss');
  assert.equal(cached.peek('phone'),null);
});
