import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {parseJarirSearchHtml,searchJarir} from '../server/providers/jarir.mjs';

// E1 projected from 2026-10-18 official public Jarir category HTML:
// SKU/title/MPN/SAR price/InStock/URLs verified; wrapper is reconstructed,
// not a verbatim merchant HTML dump. No invented merchant prices or images.
const rows=[
 ['668751','Sony PlayStation 5 Slim (DIG) 825 GB SSD, White','CFI2116B01Y',2529,'sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html'],
 ['677770','Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with DualSense Wireless Controller, White','CFI2116ACFIZC',3049,'sony-playstation-5-slim-gaming-consoles-and-handheld-677770.html'],
 ['627671','Sony PlayStation 5 Slim (DIG) 1 TB, White','CFI2016B01Y',2529,'sony-playstation-5-gaming-consoles-and-handheld-627671.html'],
 ['627678','Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, White','CFI2016A01Y',2749,'sony-playstation-5-gaming-consoles-and-handheld-627678.html'],
 ['670688','Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with Fornite Flowering Chaos, White','CFI2116AFNTVC',2299,'sony-playstation-5-slim-gaming-consoles-and-handheld-670688.html'],
];
const absent=['677771','Sony PlayStation 5 Slim (DIG) 825 GB SSD, Bundle with DualSense Wireless Controller, White','CFI2116BCFIZC',2829,'sony-playstation-5-slim-dig-gaming-consoles-and-handheld-677771.html'];
const product=([sku,name,mpn,price,path],stock='InStock')=>({
 '@type':'Product',sku,name,mpn,brand:{name:'Sony'},
 url:'https://www.jarir.com/sa-en/'+path,
 offers:{'@type':'Offer',price:String(price)+'.00',priceCurrency:'SAR',availability:'https://schema.org/'+stock,
  url:'https://www.jarir.com/sa-en/'+path,seller:{name:'Jarir Bookstore'}}
});
const records=rows.map(x=>product(x));
function htmlFrom(products,visible=products){
 const schema={'@context':'https://schema.org','@type':'ItemList',itemListElement:products.map((p,i)=>({'@type':'ListItem',position:i+1,item:p}))};
 const tiles=visible.map(p=>'<div class="product-tile__item--spacer"><div class="product-tile"><a class="product-tile__link" data-product-id="'+p.sku+'" href="'+new URL(p.url).pathname+'">'+p.name+'</a></div></div>').join('');
 return '<script type="application/ld+json">'+JSON.stringify(schema)+'</script><div class="product-listing">'+tiles+'</div>';
}
const html=htmlFrom([...records,product(absent,'OutOfStock')]);
test('E1 Jarir 2026-10-18 category priced in-stock real SKUs recover, out-of-stock SKU excluded',()=>{
 const offers=parseJarirSearchHtml(html,48),ids=new Set(offers.map(o=>o.sourceMeta.productId));
 for(const id of rows.map(r=>r[0]))assert.ok(ids.has(id),'missing real category '+id);
 assert.ok(!ids.has('677771'));
 assert.ok(offers.every(o=>o.availability==='in_stock'&&o.currency==='SAR'&&o.observedAt&&o.sourceUrl.startsWith('https://www.jarir.com/sa-en/')));
});
test('E2 category cannot invent phantom/offsite/foreign currency/mismatched or unpriced offers',()=>{
 const valid=records[2],variants=[
  {...valid,sku:'123456'},
  {...valid,url:'https://elsewhere.example/item.html'},
  {...valid,offers:{...valid.offers,priceCurrency:'AED'}},
  {...valid,offers:{...valid.offers,price:0}},
  {...valid,offers:{...valid.offers,availability:'https://schema.org/OutOfStock'}},
  {...valid,offers:{...valid.offers,seller:{name:'Unknown third-party'}}},
 ];
 for(const bad of variants)assert.equal(parseJarirSearchHtml(htmlFrom([bad],[valid])).length,0,JSON.stringify(bad));
 assert.equal(parseJarirSearchHtml(htmlFrom([valid],[])).length,0,'no visible tile = no offer');
});
test('E1 real missed category offers enrich bounded PS5 Constructor while preserving identity',async t=>{
 const fetchBefore=globalThis.fetch,lookupBefore=dns.lookup;
 t.after(()=>{globalThis.fetch=fetchBefore;dns.lookup=lookupBefore});
 dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
 let pages=0;
 globalThis.fetch=async input=>{
  const u=new URL(input);
  if(u.hostname==='ac.cnstrc.com')return Response.json({response:{results:rows.slice(0,2).map(([id,name,,price,path])=>({value:name,data:{id,price,url:path,metadata:{brand:'Sony'}}}))}});
  if(u.hostname==='www.jarir.com'&&u.pathname==='/sa-en/sony-ps5-consoles-4518-x.html'){
   pages++;return new Response(html,{headers:{'content-type':'text/html'}});
  }
  throw Error('unexpected source '+u.origin+u.pathname);
 };
 const result=await searchJarir('PS5',24,'PS5');
 const ids=new Set(result.offers.map(o=>o.sourceMeta.productId));
 for(const id of rows.map(r=>r[0]))assert.ok(ids.has(id),'missing customer offer '+id);
 assert.ok(!ids.has('677771'),'OOS never sold as in-stock');
 assert.equal(pages,1,'single bounded official category fetch');
 assert.equal(result.offers.find(o=>o.sourceMeta.productId==='670688').exactMatch,true);
});


test('v15.17 category + successful empty Constructor preserves genuine controller package for both bundle intents',async t=>{
 const beforeFetch=globalThis.fetch,beforeDns=dns.lookup;
 t.after(()=>{globalThis.fetch=beforeFetch;dns.lookup=beforeDns});
 dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
 let categoryCalls=0;
 globalThis.fetch=async input=>{
   const url=new URL(input);
   if(url.hostname==='ac.cnstrc.com')return Response.json({response:{results:[]}});
   if(url.hostname==='www.jarir.com'&&url.pathname==='/sa-en/sony-ps5-consoles-4518-x.html'){
     categoryCalls++;
     return new Response(html,{headers:{'content-type':'text/html'}});
   }
   throw Error('Unexpected transport '+url.origin+url.pathname);
 };
 for(const query of ['PS5 DualSense Bundle','بلايستيشن 5 مع يد إضافية']){
   const out=await searchJarir(query,24,query);
   const exact=out.offers.filter(o=>o.exactMatch);
   assert.deepEqual(exact.map(o=>o.sourceMeta.productId),['677770'],query);
   assert.equal(exact[0].specs.modelNumber,'CFI2116ACFIZC');
   assert.equal(exact[0].sourceMeta.parsedFrom,'jarir-category-jsonld');
   assert.equal(exact[0].productPrice,3049);
   assert.ok(!exact.some(o=>['670688','677771'].includes(o.sourceMeta.productId)),
     'game bundle and OOS bundle cannot satisfy extra-controller intent');
   assert.equal(out.errors.length,0);
 }
 assert.ok(categoryCalls<=1,'no duplicated catalog transport for repeated verified queries');
});


// v15.18 source trust: the following stock/price transition is a simulated
// FUTURE change to a real SKU 670688; it is not a newly observed Jarir event.
// Verifies public category TTL and bounded single-flight, with no crawling.
test('v15.18 Jarir category TTL expires previous InStock evidence, refetches once, rejects changed OutOfStock',async t=>{
 const oldFetch=globalThis.fetch,oldLookup=dns.lookup,oldNow=Date.now;
 t.after(()=>{globalThis.fetch=oldFetch;dns.lookup=oldLookup;Date.now=oldNow});
 dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
 let timeShift=180000,categoryReads=0,changed=false;
 Date.now=()=>oldNow()+timeShift;
 const reduced=records.map(p=>p.sku==='670688'?{
   ...p,offers:{...p.offers,price:'2399.00',availability:'https://schema.org/OutOfStock'}
 }:p);
 globalThis.fetch=async url=>{
   const u=new URL(url);
   if(u.hostname==='ac.cnstrc.com')return Response.json({response:{results:rows.slice(0,2).map(([id,name,,price,path])=>({
     value:name,data:{id,price,url:path,metadata:{brand:'Sony'}}
   }))}});
   if(u.hostname==='www.jarir.com'&&u.pathname==='/sa-en/sony-ps5-consoles-4518-x.html'){
     categoryReads++;
     return new Response(changed?htmlFrom(reduced):html,{
       headers:{'content-type':'text/html'}});
   }
   throw Error('unexpected external source in isolated category TTL replay');
 };
 const baseline=await Promise.all(Array.from({length:3},()=>searchJarir('PS5',24,'PS5')));
 assert.equal(categoryReads,1,'concurrent requests must share one category read');
 for(const result of baseline)assert.ok(result.offers.some(o=>
   o.sourceMeta.productId==='670688'&&o.availability==='in_stock'&&o.productPrice===2299));
 changed=true;timeShift+=46000;
 const subsequent=await Promise.all(Array.from({length:3},()=>searchJarir('PS5',24,'PS5')));
 assert.equal(categoryReads,2,'expired 45s cache must refetch once');
 for(const result of subsequent){
   assert.ok(!result.offers.some(o=>o.sourceMeta.productId==='670688'),
     'a newly OOS package may not remain a verified in-stock category offer');
   assert.ok(result.offers.some(o=>o.sourceMeta.productId==='627671'));
   assert.ok(result.offers.some(o=>o.sourceMeta.productId==='627678'));
 }
});
