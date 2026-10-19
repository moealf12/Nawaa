// Regression: first-screen group ranking must value clearly better query evidence
// above a merely cheaper uncertain match, without hiding cheap equivalent offers.
// Synthetic score fixtures: not live merchant observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {groupComparableOffers} from '../src/search-core.mjs';

function offer(sku,price,confidence,availability='in_stock'){
  return {provider:'jarir-direct',providerMarket:'jarir-sa',merchant:'Jarir',
    title:'HP Pavilion 15 Laptop '+sku,specs:{brand:'HP',deviceType:'HP Pavilion 15',modelNumber:sku,storage:'512GB'},
    sourceUrl:'https://www.jarir.com/sa-en/'+sku,
    productPrice:price,shipping:null,importCost:null,tax:null,mandatoryFees:0,discount:0,
    condition:'new',availability,canShipToSaudi:true,exactMatch:true,
    matchConfidence:confidence,priceConfidence:'incomplete'};
}
test('v17.5: first visible product groups rank materially stronger identity evidence above a low price',()=>{
 const cheaper=offer('15-eg001',900,.90);
 const stronger=offer('15-eg002',2500,.99);
 const groups=groupComparableOffers([cheaper,stronger]);
 assert.equal(groups.length,2,'distinct merchant model IDs remain different groups');
 assert.equal(groups[0].bestOffer.specs.modelNumber,'15-eg002',
   'stronger product identification must not be suppressed by a cheap weak match');
 assert.equal(groups[1].bestOffer.specs.modelNumber,'15-eg001',
   'related cheap product remains discoverable');
});
test('v17.5: equivalent confidence groups still rank lowest legitimate price first',()=>{
 const a=offer('15-eg003',1800,.98),b=offer('15-eg004',1700,.97);
 assert.equal(groupComparableOffers([a,b])[0].bestOffer.specs.modelNumber,'15-eg004');
});
test('v17.5: unavailable products do not jump above confirmed available groups',()=>{
 const a=offer('15-eg005',1900,.99,'out_of_stock'),b=offer('15-eg006',2100,.90,'in_stock');
 assert.equal(groupComparableOffers([a,b])[0].bestOffer.specs.modelNumber,'15-eg006');
});

test('v17.5: first-screen ranking is deterministic across source arrival permutations',()=>{
 const strong=offer('15-eg201',3000,.99);
 const middle=offer('15-eg202',2000,.95);
 const cheaper=offer('15-eg203',1000,.90);
 const permutations=[
  [strong,middle,cheaper],[cheaper,middle,strong],
  [strong,cheaper,middle],[middle,strong,cheaper],
  [middle,cheaper,strong],[cheaper,strong,middle],
 ];
 for(const input of permutations){
  const ranked=groupComparableOffers(input).map(group=>group.bestOffer.specs.modelNumber);
  assert.deepEqual(ranked,['15-eg202','15-eg201','15-eg203'],
    'stable confidence cohort must be independent of merchant response arrival order');
 }
});
