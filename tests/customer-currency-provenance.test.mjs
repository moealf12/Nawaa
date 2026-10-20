// Controlled currency-provenance regression. Prices below are synthetic,
// not current merchant prices. Never describe the foreign amount as SAR.
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateComparableTotal,groupComparableOffers,rankOffers} from '../src/search-core.mjs';

const base={
  title:'HP Pavilion 15-eg1234 Laptop 512GB',condition:'new',
  sourceUrl:'https://example.invalid/hp-15-eg1234',
  exactMatch:true,matchConfidence:.99,availability:'in_stock',canShipToSaudi:true,
  specs:{brand:'HP',deviceType:'HP Pavilion 15-eg1234',modelNumber:'15-eg1234',storage:'512GB'},
  shipping:0,importCost:0,tax:0,mandatoryFees:0,discount:0,
  priceConfidence:'verified'
};
function offer(merchant,price,currency,other={}){
  return {...base,merchant,productPrice:price,currency,...other};
}
test('v18.1 currency RED: unconverted AED must never be displayed or compared as SAR',()=>{
  const foreign=offer('Unconverted UAE Merchant',800,'AED',{originalCurrency:'AED'});
  const safe=offer('Jarir',3600,'SAR');
  assert.equal(calculateComparableTotal(foreign),null,'a foreign raw amount is not a SAR comparable total');
  const ranked=rankOffers([foreign,safe]);
  const unsafe=ranked.find(o=>o.merchant==='Unconverted UAE Merchant');
  assert.equal(unsafe.productPrice,null,'the customer card must not label AED 800 as SAR 800');
  assert.equal(unsafe.totalSAR,null);
  assert.equal(unsafe.originalProductPrice,800,'preserve the factual source price for diagnosis');
  assert.equal(ranked[0].merchant,'Jarir','genuinely SAR-priced offer should lead');
  const groups=groupComparableOffers([foreign,safe]);
  assert.equal(groups.length,1,'same manufacturer model should remain comparable');
  assert.equal(groups[0].bestValue,3600,'the displayed lowest SAR price must be the confirmed SAR offer');
});
test('v18.1 currency: successfully converted international price remains eligible',()=>{
 const converted=offer('Converted UAE Merchant',3100,'SAR',{originalCurrency:'AED',originalProductPrice:3000,
   fx:{rate:1.0333333333,source:'Frankfurter',observedAt:'2026-10-19T00:00:00Z'}});
 assert.equal(rankOffers([converted])[0].productPrice,3100);
 assert.equal(calculateComparableTotal(converted),3100);
});
test('v18.1 currency: a lowercase unconverted code cannot bypass the guard',()=>{
 const foreign=offer('Euro Merchant',210,'eur');
 assert.equal(rankOffers([foreign])[0].productPrice,null);
});
