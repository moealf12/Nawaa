import test from 'node:test';
import assert from 'node:assert/strict';
import {searchShopifyStore} from '../server/providers/shopify.mjs';
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
 assert.equal(result.offers[0].shipping,null);assert.equal(result.offers[0].brand,'Brand');
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
