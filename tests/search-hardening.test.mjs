import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {fetchHtmlSafe} from '../server/url-resolver.mjs';
import {searchExtraUnbxd} from '../server/providers/extra-unbxd.mjs';
import {currentSources} from '../server/source-config.mjs';
import {extractAmazonSearchOffers,configuredFreeStorefronts} from '../server/providers/free-storefronts.mjs';

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
