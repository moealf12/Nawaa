import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {fetchHtmlSafe,resolvePublicHttpsTarget} from '../server/url-resolver.mjs';
import {searchExtraUnbxd} from '../server/providers/extra-unbxd.mjs';
import {currentSources} from '../server/source-config.mjs';
import {extractAmazonSearchOffers,configuredFreeStorefronts,fetchAmazonSearchPages} from '../server/providers/free-storefronts.mjs';

for(const address of ['::ffff:127.0.0.1','::ffff:7f00:1','fe90::1','ff02::1','224.0.0.1']) test('resolver rejects non-public address '+address,async()=>{
 const oldLookup=dns.lookup,oldFetch=globalThis.fetch;
 let fetched=false;
 try {
  dns.lookup=async()=>[{address,family:address.includes(':')?6:4}];
  globalThis.fetch=async()=>{fetched=true;return new Response('ok',{headers:{'content-type':'text/html'}});};
  await assert.rejects(()=>fetchHtmlSafe('https://fixture.example/product'),/Private\/internal/);
  assert.equal(fetched,false);
 }finally{dns.lookup=oldLookup;globalThis.fetch=oldFetch;}
});
test('product resolver forwards cancellation to the active transport',async()=>{
 const oldLookup=dns.lookup,oldFetch=globalThis.fetch;
 const controller=new AbortController();
 let transportSignal;
 let markTransportStarted;
 const transportStarted=new Promise(resolve=>{markTransportStarted=resolve;});
 try{
  dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
  globalThis.fetch=async(_url,options)=>{
   transportSignal=options.signal;
   markTransportStarted();
   return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
  };
  const pending=fetchHtmlSafe('https://fixture.example/product',0,{signal:controller.signal});
  await transportStarted;
  controller.abort(new Error('store_deadline_exceeded:fixture'));
  await assert.rejects(pending,/store_deadline_exceeded:fixture/);
  assert.equal(transportSignal.aborted,true);
 }finally{dns.lookup=oldLookup;globalThis.fetch=oldFetch;}
});
test('every enabled storefront is represented as configured in runtime coverage',()=>{
 const sources=currentSources();
 for(const store of configuredFreeStorefronts()){
  const adapter='free-storefronts:'+store.id;
  assert.ok(sources.some(s=>s.status==='configured'&&(s.adapter===adapter||s.adapters?.includes(adapter))),store.id);
 }
 assert.equal(new Set(sources.map(s=>s.id)).size,sources.length);
});
test('eXtra skips absent prices rather than converting null to zero',async()=>{
 const original=globalThis.fetch;
 try{
 globalThis.fetch=async()=>Response.json({response:{products:[{id:'123',name:'HP Laptop',currentPrice:null,sellingPrice:'1200'}]}});
 const result=await searchExtraUnbxd('HP');
 assert.equal(result.offers[0]?.productPrice,1200);
 }finally{globalThis.fetch=original;}
});
test('Amazon UAE search cards retain AED and UAE product URLs',()=>{
 const html='<div data-asin="B0ABC12345"><h2>Apple AirPods</h2><img alt="Apple AirPods" src="https://img.example/airpods"><span class="a-price"><span class="a-offscreen">AED 299.00</span></span></div>';
 const offers=extractAmazonSearchOffers(html,'airpods','https://www.amazon.ae');
 assert.equal(offers.length,1);
 assert.equal(offers[0].currency,'AED');
 assert.equal(offers[0].price,299);
 assert.equal(offers[0].sourceUrl,'https://www.amazon.ae/dp/B0ABC12345');
});

test('Amazon ignores crossed-out price and takes current selling price',()=>{
 const html='<div data-asin="B0ABC12345"><h2>HP Laptop</h2><img alt="HP Laptop" src="https://img.example/x"><span class="a-price a-text-price"><span class="a-offscreen">SAR 4,000</span></span><span class="a-price"><span class="a-offscreen">SAR 2,999</span></span></div>';
 assert.equal(extractAmazonSearchOffers(html,'HP')[0]?.price,2999);
});
test('Amazon never attributes an external URL or another ASIN to a search card',()=>{
 for(const href of ['https://evil.example/dp/B0ABC12345','/dp/B0ZZZ12345']){
 const html='<div data-asin="B0ABC12345"><h2>HP Laptop</h2><a href="'+href+'">HP Laptop</a><img alt="HP Laptop" src="https://img.example/x"><span class="a-price"><span class="a-offscreen">SAR 2,999</span></span></div>';
 assert.equal(extractAmazonSearchOffers(html,'HP')[0]?.sourceUrl,'https://www.amazon.sa/dp/B0ABC12345');
 }
});

test('Amazon page acquisition retries one transient failure and preserves successful siblings',async()=>{
 const attempts=new Map();
 const result=await fetchAmazonSearchPages('https://www.amazon.sa/s?k=hp',{
  pageStart:1,
  pageCount:2,
  wait:async()=>{},
  fetchPage:async url=>{
   const page=new URL(url).searchParams.get('page');
   attempts.set(page,(attempts.get(page)||0)+1);
   if(page==='1'&&attempts.get(page)===1){const error=new Error('timed out');error.name='TimeoutError';throw error;}
   return {html:'page-'+page,finalUrl:url};
  },
 });
 assert.equal(attempts.get('1'),2);
 assert.equal(attempts.get('2'),1);
 assert.deepEqual(result.map(page=>page.html),['page-1','page-2']);
});

test('Amazon page acquisition does not retry permanent HTTP failures',async()=>{
 let attempts=0;
 await assert.rejects(()=>fetchAmazonSearchPages('https://www.amazon.sa/s?k=hp',{
   pageStart:1,
   pageCount:1,
   wait:async()=>{},
   fetchPage:async()=>{attempts+=1;throw new Error('HTTP 404');},
  }),/HTTP 404/);
 assert.equal(attempts,1);
});

test('Amazon page acquisition returns successful siblings by its shared deadline',async()=>{
 const started=Date.now();
 let stalledSignal;
 const result=await fetchAmazonSearchPages('https://www.amazon.sa/s?k=hp',{
  pageStart:1,
  pageCount:2,
  deadlineMs:50,
  wait:async()=>{},
  fetchPage:async (url,{signal}={})=>{
   const page=new URL(url).searchParams.get('page');
   if(page==='2'){
    stalledSignal=signal;
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
   }
   return {html:'page-'+page,finalUrl:url};
  },
 });
 assert.ok(Date.now()-started<500);
 assert.deepEqual(result.map(page=>page.html),['page-1']);
 assert.equal(stalledSignal.aborted,true);
});

test('eXtra follows catalog pages instead of silently dropping products after 24',async()=>{
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async url=>{
   const u=new URL(url);const start=Number(u.searchParams.get('start'));const rows=Number(u.searchParams.get('rows'));
   return Response.json({response:{numberOfProducts:55,products:Array.from({length:Math.min(rows,55-start)},(_,i)=>({id:String(start+i),name:'HP Laptop '+(start+i),price:1000+start+i}))}});
  };
  const result=await searchExtraUnbxd('HP',Infinity);
  assert.equal(result.offers.length,55);
  assert.equal(new Set(result.offers.map(o=>o.sourceUrl)).size,55);
 }finally{globalThis.fetch=original;}
});

test('general storefront search retains all structured-price results beyond four',async()=>{
 const {searchFreeStorefronts}=await import('../server/providers/free-storefronts.mjs');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
   if(String(url).startsWith('https://core.dxpapi.com/'))return Response.json({response:{numFound:12,docs:Array.from({length:12},(_,i)=>({pid:String(i),title:'Centrepoint Shirt '+i,sale_price:100+i,url:'/buy-shirt-'+i}))}});
   return new Response('',{headers:{'content-type':'text/html'}});
  };
  const result=await searchFreeStorefronts('centrepoint',{storeLimit:1});
  assert.equal(result.offers.length,12);
 }finally{globalThis.fetch=original;}
});

test('later catalog-page failure preserves verified items and exposes partial failure',async()=>{
 const {searchFreeStorefronts}=await import('../server/providers/free-storefronts.mjs');
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
   const u=new URL(url);
   if(u.hostname==='core.dxpapi.com'&&u.searchParams.get('start')==='0')return Response.json({response:{numFound:200,docs:Array.from({length:100},(_,i)=>({pid:String(i),title:'Centrepoint Shirt '+i,sale_price:100+i,url:'/buy-shirt-'+i}))}});
   return new Response('',{status:503});
  };
  const result=await searchFreeStorefronts('centrepoint',{storeLimit:1});
  assert.equal(result.offers.length,100);
  assert.ok(result.errors.some(e=>/503/.test(e.error)));
 }finally{globalThis.fetch=original;}
});

test("public URL resolution pins the validated DNS address for the transport layer",async()=>{
 const old=dns.lookup;
 try{
  dns.lookup=async()=>[{address:'93.184.216.34',family:4},{address:'2606:2800:220:1:248:1893:25c8:1946',family:6}];
  const target=await resolvePublicHttpsTarget('https://example.com/product');
  assert.equal(target.address,'93.184.216.34');
  assert.equal(target.family,4);
  assert.equal(target.parsed.hostname,'example.com');
 }finally{dns.lookup=old;}
});
