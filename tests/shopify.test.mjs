import test from 'node:test';
import assert from 'node:assert/strict';
import {searchShopifyStore} from '../server/providers/shopify.mjs';
import {sameOfferIdentity} from '../server/product-identity.mjs';
const store={id:'fixture',name:'Fixture',baseUrl:'https://fixture.example',countryCode:'US',currency:'USD',saudiDelivery:'forwarding_required'};
function api({currency='USD',failProduct=false}={}) {
 return async url=>{
  const path=new URL(url).pathname;
  if(path==='/cart.js')return {ok:true,json:async()=>({currency})};
  if(path==='/search/suggest.json')return {ok:true,json:async()=>({resources:{results:{products:[{handle:'shirt',title:'Shirt',price:'9.99',available:true}]}}})};
  if(failProduct)throw Error('product unavailable');
  assert.equal(path,'/products/shirt.js');
  return {ok:true,json:async()=>({title:'Shirt',vendor:'Brand',type:'Clothing',featured_image:'//cdn.example/shirt.jpg',variants:[{id:1,title:'S',price:999,available:false},{id:2,title:'M',price:2499,available:true,sku:'SHIRT-M'},{id:3,title:'L',price:2999,available:true}]})};
 };
}
test('prices correspond to available variants, cents converted once, shipping stays unconfirmed',async()=>{
 const result=await searchShopifyStore('shirt',store,{fetchImpl:api(),convertMoney:async(value,currency)=>{assert.equal(currency,'USD');return {value:value*3.75,rate:3.75,source:'fixture'};}});
 assert.equal(result.offers.length,2);
 assert.equal(result.offers[0].originalProductPrice,24.99);assert.ok(Math.abs(result.offers[0].productPrice - 93.7125)<1e-8);
 assert.equal(result.offers[0].title,'Shirt · M');assert.equal(result.offers[0].availability,'in_stock');
 assert.equal(result.offers[0].sourceUrl,'https://fixture.example/products/shirt?variant=2');
 assert.equal(result.offers[0].image,'https://cdn.example/shirt.jpg');
 assert.equal(result.offers[0].canShipToSaudi,null);assert.equal(result.offers[0].directShippingToSaudi,false);
 assert.equal(result.offers[0].shipping,null);assert.equal(result.offers[0].vendor,'Brand');assert.equal(result.offers[0].brand,null);
});
test('currency mismatches reject a store rather than inventing a conversion',async()=>{
 await assert.rejects(()=>searchShopifyStore('shirt',store,{fetchImpl:api({currency:'CAD'})}),/currency changed/);
});
test('failed variant lookup never falls back to a predictive minimum price',async()=>{
 const result=await searchShopifyStore('shirt',store,{fetchImpl:api({failProduct:true})});
 assert.deepEqual(result.offers,[]);assert.equal(result.errors.length,1);
});
test('foreign currency without a conversion retains original price and no SAR claim',async()=>{
 const result=await searchShopifyStore('shirt',store,{fetchImpl:api(),convertMoney:async()=>{throw Error('fx offline');}});
 assert.equal(result.offers[0].productPrice,null);assert.equal(result.offers[0].originalProductPrice,24.99);
});

test('stores with regional currency use the currency actually returned by the cart endpoint',async()=>{
 const dynamic={...store};delete dynamic.currency;
 const result=await searchShopifyStore('shirt',dynamic,{fetchImpl:api({currency:'SAR'}),convertMoney:async(value,currency)=>{assert.equal(currency,'SAR');return {value,rate:1,source:'identity'};}});
 assert.equal(result.offers[0].originalCurrency,'SAR');assert.equal(result.offers[0].productPrice,24.99);
});

test('unrelated predictive suggestions are excluded from offers',async()=>{
 const result=await searchShopifyStore('coffee',store,{fetchImpl:api()});
 assert.deepEqual(result.offers,[]);assert.deepEqual(result.errors,[]);
});
test('a full brand query can match products whose titles omit the brand',async()=>{
 const result=await searchShopifyStore('brand',store,{fetchImpl:api(),convertMoney:async value=>({value})});
 assert.equal(result.offers.length,2);
});

function productApi(product,handle='fixture-product') {
 return async url=>{
  const pathname=new URL(url).pathname;
  if(pathname==='/cart.js') return Response.json({currency:'USD'});
  if(pathname==='/search/suggest.json') return Response.json({resources:{results:{products:[{handle,title:product.title,vendor:product.vendor}]}}});
  assert.equal(pathname,`/products/${handle}.js`);
  return Response.json(product);
 };
}
test('Shopify vendor is not a conflicting manufacturer brand in page identity',async()=>{
 const product={title:'Foldable Wireless Qi2.2 Charger Stand (Mag Fit) | EF323MQ',vendor:'Power',type:'Stands',options:[],variants:[{id:44817398595631,title:'Black / In Stock',available:true,price:9999,sku:'ACH10398'}]};
 const r=await searchShopifyStore('charger',store,{fetchImpl:productApi(product),convertMoney:async value=>({value:value*3.75})});
 assert.equal(r.offers.length,1);
 const offer=r.offers[0];assert.equal(offer.vendor,'Power');assert.equal(offer.brand,null);
 const page={...offer,title:product.title,vendor:null,brand:'Spigen',resolvedPageUrl:offer.sourceUrl};
 assert.equal(sameOfferIdentity(offer,page),true);
 assert.equal(sameOfferIdentity({...offer,brand:'Other manufacturer'},page),false);
});
test('Shopify matches late base-phone variants before limiting available options',async()=>{
 const product={title:'iPhone 17 Series - Ultra Hybrid (Mag Fit)',vendor:'iPhone 17 Series',type:'Clear Cases',options:[],variants:[
  {id:44689013768239,title:'iPhone 17 Pro Max / Clear Orange / In Stock',available:true,price:3999,sku:'ACS11107'},
  {id:44458193780783,title:'iPhone 17 Pro Max / Clear White / In Stock',available:true,price:3999,sku:'ACS10035'},
  {id:44458193813551,title:'iPhone 17 Pro Max / Clear Graphite / In Stock',available:true,price:3999,sku:'ACS10036'},
  {id:44458194042927,title:'iPhone 17 Pro / Clear White / In Stock',available:true,price:3999,sku:'ACS10066'},
  {id:44458194370607,title:'iPhone 17 / Clear White / In Stock',available:true,price:3999,sku:'ACS10082'},
  {id:44458360045615,title:'iPhone 17 / Clear Graphite / In Stock',available:true,price:3999,sku:'ACS10083'},
  {id:44458370793519,title:'iPhone 17 / Clear Gold / In Stock',available:true,price:3999,sku:'ACS10084'},
  {id:777,title:'iPhone 17 / Clear Green / In Stock',available:true,price:3999,sku:'ACS10085'},
 ]};
 const options={fetchImpl:productApi(product),convertMoney:async value=>({value:value*3.75})};
 const r=await searchShopifyStore('iPhone 17 case',store,options);
 assert.deepEqual(r.offers.map(o=>new URL(o.sourceUrl).searchParams.get('variant')),['44458194370607','44458360045615','44458370793519']);
 assert.deepEqual(r.errors,[]);
 const pro=await searchShopifyStore('iPhone 17 Pro case',store,options);
 assert.deepEqual(pro.offers.map(o=>o.sku),['ACS10066']);
 const missing=await searchShopifyStore('iPhone 16 case',store,options);
 assert.deepEqual(missing.offers,[]);
});
test('explicit Shopify product brand remains separate from vendor',async()=>{
 const product={title:'Charger',brand:'Spigen',vendor:'Power',type:'Chargers',variants:[{id:1,title:'Default Title',price:999,available:true}]};
 const r=await searchShopifyStore('charger',store,{fetchImpl:productApi(product),convertMoney:async value=>({value})});
 assert.equal(r.offers[0].brand,'Spigen');assert.equal(r.offers[0].vendor,'Power');
});
test('Shopify cannot hide a conflicting qualified Series variant',async()=>{
 const product={title:'iPhone 17 Case',vendor:'Cases',type:'Clear Cases',variants:[{id:1,title:'iPhone 17 Pro Max Series',price:3999,available:true}]};
 const r=await searchShopifyStore('iPhone 17 case',store,{fetchImpl:productApi(product),convertMoney:async value=>({value})});
 assert.deepEqual(r.offers,[]);
});

for(const endpoint of ['/cart.js','/search/suggest.json','/products/shirt.js']) {
 test(`Shopify recovers two transient 503 responses from ${endpoint}`,async()=>{
  const counts=new Map(),delays=[];const original=api();
  const fetchImpl=async(url,options)=>{
   const pathname=new URL(url).pathname;
   counts.set(pathname,(counts.get(pathname)||0)+1);
   assert.ok(options.signal instanceof AbortSignal);
   if(pathname===endpoint&&counts.get(pathname)<3)return new Response('Unavailable',{status:503});
   return original(url);
  };
  const r=await searchShopifyStore('shirt',store,{fetchImpl,convertMoney:async value=>({value}),waitForRetry:async(ms,signal)=>{delays.push(ms);assert.ok(signal instanceof AbortSignal);}});
  assert.equal(counts.get(endpoint),3);assert.deepEqual(delays,[750,1500]);
  assert.deepEqual(r.errors,[]);assert.equal(r.offers[0].sku,'SHIRT-M');
  assert.equal(r.offers[0].originalProductPrice,24.99);
 });
}
test('persistent Shopify 503 stops after three requests without a predictive price fallback',async()=>{
 let requests=0;const delays=[];const original=api();
 const fetchImpl=async url=>{
  if(new URL(url).pathname!=='/products/shirt.js')return original(url);
  requests++;return new Response('Unavailable',{status:503});
 };
 const r=await searchShopifyStore('shirt',store,{fetchImpl,waitForRetry:async ms=>delays.push(ms)});
 assert.equal(requests,3);assert.deepEqual(delays,[750,1500]);assert.deepEqual(r.offers,[]);
 assert.equal(r.errors.length,1);assert.match(r.errors[0].error,/HTTP 503/);
});
test('persistent Shopify cart failure remains a failed search rather than an empty negative control',async()=>{
 let requests=0;const original=api();
 await assert.rejects(()=>searchShopifyStore('nawaa-no-such-product',store,{fetchImpl:async url=>{
  if(new URL(url).pathname!=='/cart.js')return original(url);
  requests++;return new Response('Unavailable',{status:503});
 },waitForRetry:async()=>{}}),/HTTP 503/);
 assert.equal(requests,3);
});
test('Shopify respects Retry-After and never shortens a delay beyond its search budget',async()=>{
 const original=api();
 for(const [header,expectedRequests,expectedDelays] of [['2',3,[2000,2000]],['60',1,[]]]){
  let requests=0;const delays=[];
  const r=await searchShopifyStore('shirt',store,{fetchImpl:async url=>{
   if(new URL(url).pathname!=='/products/shirt.js')return original(url);
   requests++;return new Response('Unavailable',{status:503,headers:{'Retry-After':header}});
  },waitForRetry:async ms=>delays.push(ms)});
  assert.equal(requests,expectedRequests);assert.deepEqual(delays,expectedDelays);assert.deepEqual(r.offers,[]);
 }
});
test('Shopify does not retry permanent HTTP failures or invalid successful JSON',async()=>{
 const original=api();
 for(const response of [()=>new Response('Forbidden',{status:403}),()=>new Response('not json',{status:200})]){
  let requests=0;
  const r=await searchShopifyStore('shirt',store,{fetchImpl:async url=>{
   if(new URL(url).pathname!=='/products/shirt.js')return original(url);
   requests++;return response();
  },waitForRetry:async()=>assert.fail('unexpected retry')});
  assert.equal(requests,1);assert.deepEqual(r.offers,[]);assert.equal(r.errors.length,1);
 }
});
test('Shopify abort during retry stops additional requests and retains a failed lookup',async()=>{
 let requests=0;const original=api();
 const r=await searchShopifyStore('shirt',store,{fetchImpl:async url=>{
  if(new URL(url).pathname!=='/products/shirt.js')return original(url);
  requests++;return new Response('Unavailable',{status:503});
 },waitForRetry:async()=>{throw new DOMException('expired','TimeoutError');}});
 assert.equal(requests,1);assert.deepEqual(r.offers,[]);assert.match(r.errors[0].error,/expired/);
});
test('Shopify bounds product lookup concurrency to two and preserves suggestion order',async()=>{
 let active=0,peak=0;const products=Array.from({length:6},(_,i)=>({handle:`shirt-${i}`,title:'Shirt'}));
 const fetchImpl=async url=>{
  const pathname=new URL(url).pathname;
  if(pathname==='/cart.js')return Response.json({currency:'USD'});
  if(pathname==='/search/suggest.json')return Response.json({resources:{results:{products}}});
  const i=Number(pathname.match(/shirt-(\d+)\.js$/)[1]);active++;peak=Math.max(peak,active);
  await new Promise(resolve=>setTimeout(resolve,8-i));active--;
  return Response.json({title:'Shirt',variants:[{id:i+1,title:'Default Title',price:999,available:true,sku:`SKU-${i}`} ]});
 };
 const r=await searchShopifyStore('shirt',store,{limit:6,fetchImpl,convertMoney:async value=>({value})});
 assert.equal(peak,2);assert.deepEqual(r.offers.map(x=>x.sku),products.map((_,i)=>`SKU-${i}`));assert.deepEqual(r.errors,[]);
});
