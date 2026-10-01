import test from 'node:test';
import assert from 'node:assert/strict';
import * as query from '../src/search-query.mjs';
import * as core from '../src/search-core.mjs';
const offer=(title,price,brand='HP')=>({title,productPrice:price,condition:'new',availability:'in_stock',merchant:'Store',specs:{brand},...query.assessOfferMatch(brand,{title,condition:'new',specs:{brand}})});
const sections=(q,offers)=>core.buildDiscoverySections?.(q,core.groupComparableOffers(offers)) || [];

test('brand search leads with core categories rather than inexpensive accessories',()=>{
  const result=sections('hp',[offer('HP USB Mouse',20),offer('HP LaserJet Printer',700),offer('HP Pavilion Laptop',3000),offer('HP Monitor',500)]);
  assert.deepEqual(result.map(s=>s.key),['laptop','printer','monitor','accessory']);
});
test('explicit requested category overrides brand priorities and excludes other categories',()=>{
  const result=sections('طابعة hp',[offer('HP Pavilion Laptop',3000),offer('HP LaserJet Printer',700)]);
  assert.deepEqual(result.map(s=>s.key),['printer']);
  assert.equal(query.assessOfferMatch('طابعة hp',offer('HP LaserJet Printer',700)).exactMatch,true);
});
test('generic categories work across brands and without model identifiers',()=>{
  const result=sections('لابتوب',[offer('HP Pavilion Laptop',3000),offer('Dell Inspiron Notebook',2500,'Dell'),offer('HP LaserJet Printer',700)]);
  assert.equal(result[0]?.groups.length,2);
  assert.equal(query.parseSearchIntent('لابتوب').category,'laptop');
});
test('unknown brands retain matching products without inventing a popularity priority',()=>{
  const result=sections('Acme',[offer('Acme Monitor',500,'Acme'),offer('Acme Laptop',3000,'Acme')]);
  assert.equal(result.reduce((n,s)=>n+s.groups.length,0),2);
  assert.equal(query.parseSearchIntent('Acme').discoveryMode,'general');
  assert.equal(query.parseSearchIntent('hp laptop 16gb').discoveryMode,'specific');
});
test('brand metadata can match when titles omit it; requested accessories are never suppressed',()=>{
  assert.equal(query.assessOfferMatch('hp',{title:'Pavilion Laptop',condition:'new',specs:{brand:'HP'}}).exactMatch,true);
  const result=sections('hp mouse',[offer('HP USB Mouse',20),offer('HP Pavilion Laptop',3000)]);
  assert.deepEqual(result.map(s=>s.key),['accessory']);
});
test('brand priorities generalize and empty results remain empty',()=>{
  assert.deepEqual(sections('sony',[offer('Sony Bravia TV',4000,'Sony'),offer('Sony PS5 Console',2400,'Sony')]).map(s=>s.key),['tv','console']);
  assert.deepEqual(sections('',[]),[]);
});
test('explicit product types override ambiguous family names and brand discovery includes Pro products',()=>{
  assert.equal(query.productCategory?.({title:'HP Pavilion Desktop PC'}),'desktop');
  assert.equal(query.productCategory?.({title:'HP Envy Printer'}),'printer');
  assert.equal(query.assessOfferMatch('apple',{title:'Apple iPhone 17 Pro',condition:'new',specs:{brand:'Apple'}}).exactMatch,true);
  assert.equal(query.assessOfferMatch('Acme',{title:'Acme Charger',condition:'new'}).exactMatch,true);
});

test('current merchant laptop family names classify without numeric SKUs',()=>{ assert.equal(query.productCategory?.({title:'HP OmniBook 5 Flip AI PC x360, Intel Core 5, 16 GB, 15.6 FHD'}),'laptop'); });
test('built-in keyboard specifications do not turn a laptop into an accessory',()=>{
 assert.equal(query.productCategory?.({title:'HP Pavilion Laptop with Backlit Keyboard'}),'laptop');
 assert.equal(query.productCategory?.({title:'HP Laptop Charger Adapter'}),'accessory');
});

test('coffee product types and Arabic queries produce coffee results without unrelated accessories',()=>{
 const coffee={title:'Valhalla Java Odinforce Blend',productType:'Coffee',brand:'Death Wish Coffee Company',condition:'new'};
 assert.equal(query.assessOfferMatch('قهوة',coffee).exactMatch,true);
 assert.equal(query.productCategory(coffee),'coffee');
 assert.equal(query.assessOfferMatch('قهوة',{title:'USB Cable',productType:'Accessories',condition:'new'}).exactMatch,false);
});

test('Arabic Swarovski brand discovery canonicalizes to English merchant data',()=>{
  assert.equal(query.normalizeSearchQuery('سواروفسكي'),'swarovski');
  const intent=query.parseSearchIntent('سواروفسكي');
  assert.equal(intent.brand,'swarovski');
  assert.equal(intent.discoveryMode,'brand');

  const necklace=offer('Swarovski Matrix Tennis Necklace',699,'Swarovski');
  const watch=offer('Swarovski Octea Nova Watch',1299,'Swarovski');
  const figurine=offer('Swarovski Crystal Figurine',499,'Swarovski');

  assert.equal(query.assessOfferMatch('سواروفسكي',necklace).exactMatch,true);
  assert.equal(query.productCategory(necklace),'jewelry');
  assert.deepEqual(sections('سواروفسكي',[figurine,watch,necklace]).map(s=>s.key),['jewelry','watch','other']);
});

test('Arabic jewelry terms constrain Swarovski discovery without requiring a SKU',()=>{
  assert.equal(query.normalizeSearchQuery('قلادة سواروفسكي'),'necklace swarovski');
  assert.equal(query.parseSearchIntent('قلادة سواروفسكي').category,'jewelry');
  const result=sections('قلادة سواروفسكي',[
    offer('Swarovski Matrix Tennis Necklace',699,'Swarovski'),
    offer('Swarovski Octea Nova Watch',1299,'Swarovski'),
  ]);
  assert.deepEqual(result.map(s=>s.key),['jewelry']);
});

