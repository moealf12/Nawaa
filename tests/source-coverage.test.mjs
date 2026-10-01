import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSourceRegistry,sourceCoverageSummary} from '../src/source-registry.mjs';
import {selectDiverseOffers} from '../server/offer-selection.mjs';

test('registry separates configured connectors, disabled adapters and discovery targets',()=>{
 const registry=buildSourceRegistry({configuredProviders:['extra-unbxd','jarir-direct','sharafdg-algolia','swarovski-direct','ebay']});
 assert.equal(registry.find(s=>s.id==='ebay').status,'configured');
 assert.equal(registry.find(s=>s.id==='noon-sa').status,'disabled');
 assert.equal(registry.find(s=>s.id==='amazon-sa').status,'candidate');
 assert.equal(registry.find(s=>s.id==='sharafdg-sa').countryCode,'SA');
 assert.equal(registry.find(s=>s.id==='swarovski-sa').status,'configured');
 const summary=sourceCoverageSummary(registry);assert.equal(summary.configuredSources,5);assert.equal(summary.disabledSources,2);
});
test('configured Shopify merchants appear independently without exposing settings',()=>{
 const registry=buildSourceRegistry({configuredProviders:['shopify'],shopifyStores:[{id:'fixture',name:'Fixture',countryCode:'GB',currency:'GBP',baseUrl:'https://fixture.example',secret:'never-expose'}]});
 assert.equal(registry.find(s=>s.id==='shopify:fixture').status,'configured');
 assert.ok(!JSON.stringify(registry).includes('never-expose'));assert.ok(!JSON.stringify(registry).includes('fixture.example'));
 assert.equal(new Set(registry.map(s=>s.id)).size,registry.length);
});
test('large marketplaces cannot crowd out equally relevant merchants at the cap',()=>{
 const offers=Array.from({length:150},(_,i)=>({provider:'ebay',merchant:'eBay',sourceUrl:String(i),exactMatch:true,matchConfidence:.99,productPrice:i}));
 offers.push({provider:'jarir',merchant:'Jarir',exactMatch:true,matchConfidence:.95,productPrice:500});
 const selected=selectDiverseOffers(offers,120);
 assert.equal(selected.length,120);assert.ok(selected.some(o=>o.provider==='jarir'));assert.equal(selected[0].productPrice,0);
 assert.equal(offers.length,151);
});
test('related accessories never displace requested products for source diversity',()=>{
 const exact=Array.from({length:125},(_,i)=>({provider:'one',merchant:'One',exactMatch:true,matchConfidence:1,productPrice:i}));
 const accessory={provider:'two',merchant:'Two',exactMatch:false,matchConfidence:.2,productPrice:1};
 assert.ok(!selectDiverseOffers([...exact,accessory],120).includes(accessory));
 assert.deepEqual(selectDiverseOffers([],120),[]);assert.deepEqual(selectDiverseOffers(exact,0),[]);
});
test('separate Shopify merchants share capacity independently',()=>{
 const offers=['A','B','C'].flatMap(merchant=>Array.from({length:10},(_,i)=>({provider:'shopify',providerMarket:merchant,merchant,exactMatch:true,matchConfidence:1,productPrice:i})));
 const selected=selectDiverseOffers(offers,6);
 for(const merchant of ['A','B','C'])assert.equal(selected.filter(o=>o.merchant===merchant).length,2);
});

test('eBay markets do not receive separate merchant allocations',()=>{
 const offers=Array.from({length:40},(_,i)=>({provider:'ebay',providerMarket:i%2?'EBAY_US':'EBAY_GB',merchant:'eBay',exactMatch:true,matchConfidence:1,productPrice:i}));
 offers.push(...Array.from({length:10},(_,i)=>({provider:'jarir',merchant:'Jarir',exactMatch:true,matchConfidence:1,productPrice:100+i})));
 const selected=selectDiverseOffers(offers,10);assert.equal(selected.filter(o=>o.provider==='jarir').length,5);
});
