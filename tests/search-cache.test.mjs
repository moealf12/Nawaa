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


test('expired good results survive a transient empty refresh', async () => {
  const { createSearchCache } = await import('../server/search-cache.mjs');
  let now=0,calls=0;
  const cached=createSearchCache(async()=>{
    calls++;
    return calls===1 ? {offers:[{title:'iPhone 17'}],errors:[]} : {offers:[],errors:[{provider:'jarir',error:'temporary provider timeout'}]};
  },{ttl:10,staleTtl:20,now:()=>now});
  assert.equal((await cached('iphone')).offers.length,1);
  now=25;
  const rescued=await cached('iphone');
  assert.equal(calls,2);
  assert.equal(rescued.offers.length,1);
  assert.equal(rescued.offers[0].title,'iPhone 17');
  assert.equal(rescued.cache.mode,'stale-if-error');
  assert.equal(rescued.cache.stale,true);
});


// v15.12: deterministic virtual-clock check of rescored E1 item identities.
// This does NOT simulate an actual production DB restore, hot code reload,
// process restart, or an external merchant's current price.
test('PS5 SSD E1 identities survive fresh stale refresh and expiry cache transitions',async()=>{
  const {createSearchCache}=await import('../server/search-cache.mjs');
  const {assessOfferMatch}=await import('../src/search-query.mjs');
  const heatsink={
    title:'Heatsink for PS5 NVMe SSD',merchant:'GLOTRENDS',
    sourceUrl:'https://www.noon.com/saudi-en/heatsink-for-ps5-nvme-ssd/Z78E6BD03E487FC7156B1Z/p/',
    currency:'SAR',productPrice:64,condition:'new',
  };
  const ssd={
    title:'WD_BLACK 1TB SN850 NVMe SSD for PS5 Consoles Solid State Drive with Heatsink',
    merchant:'Amazon Saudi',
    sourceUrl:'https://www.amazon.sa/-/en/WD_BLACK-SN850-Consoles-Solid-Heatsink/dp/B0B4SQB1HY/ref=sr_1_140',
    currency:'SAR',productPrice:799,condition:'new',
  };
  let now=0,calls=0;
  const score=async(q)=>{
    calls++;
    return {offers:[heatsink,ssd].map(o=>({...o,...assessOfferMatch(q,o)})),errors:[]};
  };
  const cached=createSearchCache(score,{ttl:45000,staleTtl:300000,now:()=>now});
  const verify = result => {
    assert.equal(result.offers.length,2);
    const h=result.offers.find(o=>o.merchant==='GLOTRENDS');
    const d=result.offers.find(o=>o.merchant==='Amazon Saudi');
    assert.equal(h.exactMatch,false,'cooling-only item must never become exact SSD');
    assert.equal(d.exactMatch,true,'complete SSD must remain discoverable');
    assert.equal(h.productPrice,64);
    assert.equal(d.productPrice,799);
    assert.equal(h.currency,'SAR');
    assert.equal(d.currency,'SAR');
    assert.ok(h.sourceUrl.includes('Z78E6BD03E487FC7156B1Z'));
    assert.ok(d.sourceUrl.includes('B0B4SQB1HY'));
  };
  const first=await cached('PS5 SSD');
  verify(first);assert.equal(first.cache.mode,'miss');
  now=44999;
  verify(await cached('PS5 SSD'));assert.equal(calls,1);
  now=45001;
  const preview=cached.peek('PS5 SSD');
  assert.equal(preview.cache.mode,'stale');
  verify(preview);
  const stale=await cached('PS5 SSD');
  assert.equal(stale.cache.mode,'stale');verify(stale);
  const refreshed=await cached.refresh('PS5 SSD');
  verify(refreshed);
  assert.equal(calls,2);
  assert.equal(cached.peek('PS5 SSD').cache.mode,'fresh');
  now=345002;
  assert.equal(cached.peek('PS5 SSD'),null,'beyond stale window old flags are not served');
  // Re-scoring an explicitly polluted old payload ignores its historical flag.
  const oldRecord={...heatsink,exactMatch:true,matchConfidence:1,dataKind:'persisted'};
  assert.equal(assessOfferMatch('PS5 SSD',oldRecord).exactMatch,false);
});


// v15.18 E1 risk replay. The identities and original merchant titles come
// from verified 2026-10-18 Jarir PDP/category: 677770 controller package,
// 670688 separate Fortnite game package. A future merchant change below is
// deliberately simulated; it is NOT a claim that Jarir actually changed stock.
test('v15.18 RED customer opt-out of stale cache prevents old exact/stock/price certification',async()=>{
  const {createSearchCache}=await import('../server/search-cache.mjs');
  const bundle={
    title:'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with DualSense Wireless Controller, White',
    sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-677770.html',
    sourceMeta:{productId:'677770'},specs:{brand:'Sony',modelNumber:'CFI2116ACFIZC'},
    productPrice:3049,currency:'SAR',availability:'unknown',exactMatch:true,matchConfidence:1
  };
  const game={
    title:'Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with Fornite Flowering Chaos, White',
    sourceUrl:'https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-670688.html',
    sourceMeta:{productId:'670688'},specs:{brand:'Sony',modelNumber:'CFI2116AFNTVC'},
    productPrice:2299,currency:'SAR',availability:'in_stock',exactMatch:true,matchConfidence:1
  };
  let now=0,called=0;
  const provider=async()=>{
    called++;
    return {offers:called===1?[bundle,game]:[
      {...bundle,title:'Sony PS5 DualSense Controller Charging Station',
        availability:'out_of_stock',exactMatch:false,matchConfidence:0.04},
      {...game,productPrice:2399,availability:'out_of_stock',exactMatch:false,matchConfidence:0.05}
    ],errors:[]};
  };
  const cache=createSearchCache(provider,{ttl:45,staleTtl:200,now:()=>now});
  const fresh=await cache('PS5 DualSense Bundle');
  assert.equal(fresh.offers[0].exactMatch,true);
  assert.equal(fresh.offers[1].availability,'in_stock');
  now=46;
  // A customer SSE must NOT emit a formerly exact old bundle snapshot before
  // current merchant evidence has been re-evaluated.
  assert.equal(cache.peek('PS5 DualSense Bundle',{allowStale:false}),null,
    'customer-facing SSE must not publish stale exact/product-price evidence');
  const refreshed=await cache('PS5 DualSense Bundle',{allowStale:false});
  assert.equal(refreshed.offers[0].exactMatch,false);
  assert.equal(refreshed.offers[1].availability,'out_of_stock');
  assert.equal(refreshed.offers[1].productPrice,2399);
  assert.equal(called,2);
});

test('v15.18 RED failed refresh may not rescue unverifiable expired stock as current shopper evidence',async()=>{
  const {createSearchCache}=await import('../server/search-cache.mjs');
  let time=0,calls=0;
  const cached=createSearchCache(async()=>{
    calls++;
    return calls===1?{offers:[{
      title:'Sony PlayStation 5 Slim Console Blu-ray Edition Bundle with Fornite Flowering Chaos',
      sourceMeta:{productId:'670688'},productPrice:2299,currency:'SAR',
      availability:'in_stock',exactMatch:true
    }],errors:[]}:{offers:[],errors:[{provider:'jarir',error:'HTTP 503'}]};
  },{ttl:10,staleTtl:20,now:()=>time});
  await cached('PS5');
  time=25;
  const customer=await cached('PS5',{allowStale:false});
  assert.equal(customer.offers.length,0,
    'after bounded freshness failure, do not present old in_stock or exactMatch:true');
  assert.ok(customer.errors.length>0);
});
