import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSearchIntent,productCategory,assessOfferMatch,filterQueryOffers} from '../src/search-query.mjs';

// Synthetic representations of titles actually observed in candidate Chromium
// run #39346305243. Synthetic URLs; NOT additional merchant verification.
const offer=(title,sku='')=>({
 title,merchant:'Fixture merchant',
 sourceUrl:'https://example.invalid/product/'+encodeURIComponent(title),
 specs:{brand:'HP',deviceType:title,modelNumber:sku},
 productPrice:1999,condition:'new',availability:'in_stock'
});
const sleeves=[
 'HP Reversible Laptop Sleeve, for 13.5"/14.1"/13.9" Screen Size, Black/Blue',
 'HP Creator 13.3-inch Laptop Sling, Black',
 'HP Reversible Protective Laptop Sleeve, for 15.6" Screen Size, Black/Silver',
 'HP Modular Laptop Sleeve, for 15.6" Screen Size, Military Green',
 'HP Spectre Folio Laptop Sleeve, for 10.1"/10.2" Screen Size, Brown',
 'HP Laptop Bag for 15.6 inch, Black'
];
const computers=[
 'HP Pavilion 15 Laptop 512GB Intel Core i5 15-eg2345',
 'HP EliteBook 840 G10 Notebook Intel Core i7 16GB RAM',
 'HP Spectre x360 14 Laptop Intel Core Ultra 7'
];
test('v18.2 RED: HP laptop returns eligible computers but no carrying-case accessories as exact',()=>{
 const candidates=[...sleeves,...computers].map(t=>offer(t));
 assert.equal(parseSearchIntent('HP laptop').category,'laptop');
 for(const candidate of candidates.slice(0,sleeves.length)){
  assert.equal(productCategory(candidate),'accessory',candidate.title);
  assert.equal(assessOfferMatch('HP laptop',candidate).exactMatch,false,candidate.title);
 }
 const {offers}=filterQueryOffers('HP laptop',candidates);
 assert.equal(offers.filter(o=>/sleeve|sling|laptop bag/i.test(o.title)).length,0,
   'the customer must not see sleeves and slings in primary laptop results');
 assert.ok(offers.some(o=>/Pavilion/.test(o.title)));
 assert.ok(offers.some(o=>/EliteBook/.test(o.title)));
});
test('v18.2: Arabic and mixed HP laptop intent must not accept sleeves',()=>{
 for(const q of ['لابتوب اتش بي','HP لابتوب','اتش بي laptop']){
   const a=offer(sleeves[0]),b=offer(computers[0]);
   assert.equal(assessOfferMatch(q,a).exactMatch,false,q);
   assert.equal(filterQueryOffers(q,[a,b]).offers.some(o=>o.title===a.title),false,q);
   assert.equal(filterQueryOffers(q,[a,b]).offers.some(o=>o.title===b.title),true,q);
 }
});
test('v18.2: explicitly requested sleeve remains discoverable',()=>{
 const q='HP laptop sleeve',x=offer(sleeves[0]);
 assert.equal(parseSearchIntent(q).category,'accessory');
 assert.equal(productCategory(x),'accessory');
 assert.equal(assessOfferMatch(q,x).exactMatch,true);
 assert.equal(filterQueryOffers(q,[x]).offers.length,1);
});
test('v18.2: genuine laptop bundled with included sleeve keeps primary computer identity',()=>{
 const x=offer('HP Pavilion 15 Laptop 512GB with Laptop Sleeve Included','15-eg2345');
 assert.equal(productCategory(x),'laptop');
 assert.equal(assessOfferMatch('HP laptop',x).exactMatch,true);
});

test('v18.2 RED: observed Arabic HP first ten must not exact-match fan, shell, privacy screen, pen, briefcase or LCD parts',()=>{
 const observed=[
  'Jectse L77560-001 Laptop CPU Cooling Fan Fit for HP Pavilion Gaming 16-A',
  'CPU Cooling Fan for HP Pavilion X360 14m-dh Series',
  'Fegishilly Compatible with HP Envy X360-14 Laptop Protective Shell',
  'IPROKKO Laptop Privacy Screen 14 Inch for HP',
  'mCover Only Compatible with HP EliteBook 840 G7 G8 Laptop Series',
  'CaoXiong Active Pen G3 Compatible with HP EliteBook x360',
  'HP Renew Business Laptop Briefcase 14.1 inch Black',
  'HP Laptop-Rucksack für 15,6',
  'A Plus Screen Generic Laptop LED LCD Replacement for HP Pavilion 15',
 ];
 for(const title of observed){
  const item=offer(title);
  assert.equal(productCategory(item),'accessory','accessory category: '+title);
  assert.equal(assessOfferMatch('لابتوب اتش بي',item).exactMatch,false,'Arabic principal result: '+title);
 }
 const trueLaptop=offer('HP Pavilion 15 Laptop Intel Core i5 16GB 512GB SSD','15-eg999');
 const retained=filterQueryOffers('لابتوب اتش بي',[...observed.map(t=>offer(t)),trueLaptop]).offers;
 assert.deepEqual(retained.map(o=>o.title),[trueLaptop.title]);
});
test('v18.2 RED: sparse unverified generic laptop listing must not claim an exact computer',()=>{
 const uncertain=offer('HP Everyday Laptop');
 assert.equal(assessOfferMatch('لابتوب اتش بي',uncertain).exactMatch,false);
 const verified=offer('HP EliteBook 840 G10 Notebook Intel Core i7 16GB RAM','840G10');
 assert.equal(assessOfferMatch('لابتوب اتش بي',verified).exactMatch,true);
});

test('v18.2: internal laptop SSD and standalone replacement SSD cannot be conflated',()=>{
 const machine=offer('HP Pavilion 15 Laptop Intel Core i5 16GB RAM 512GB SSD','15-eg999');
 const spare=offer('HP 512GB SSD for Pavilion Laptop Intel Core i7');
 assert.equal(productCategory(machine),'laptop');
 assert.equal(assessOfferMatch('HP laptop',machine).exactMatch,true);
 assert.equal(productCategory(spare),'accessory');
 assert.equal(assessOfferMatch('HP laptop',spare).exactMatch,false);
});

test('v18.2 RED: compatible HP keyboards must never become exact laptop devices',()=>{
 const observed=[
  'HP 150 Desktop (Keyboard and Mouse), Wired, for Laptop/Desktop Computer/Gaming Desktop Computer/CPU Windows OS, Black',
  'HP OMEN Encoder Cherry MX Brown Gaming Keyboard, Wired, for Laptop/Desktop Computer/CPU Windows OS, Black',
  'HP OMEN Encoder Cherry MX Red Gaming Keyboard, Wired, for Laptop/Desktop Computer/CPU Windows OS, Black',
  'HP 970 Programmable Wireless Keyboard, Bluetooth, for Laptop/Desktop Computer/CPU Windows OS, White',
  'HP OMEN Spacer TKL Gaming Keyboard, Wireless, for Laptop/Desktop Computer/CPU Windows OS, Black',
 ];
 for(const title of observed){
  const candidate=offer(title);
  assert.equal(productCategory(candidate),'accessory',title);
  assert.equal(assessOfferMatch('لابتوب اتش بي',candidate).exactMatch,false,title);
  assert.equal(assessOfferMatch('HP laptop',candidate).exactMatch,false,title);
 }
 const laptop=offer('HP Pavilion 15 Laptop Intel Core i5 16GB RAM with Keyboard and Mouse Included','15-eg9000');
 assert.equal(productCategory(laptop),'laptop');
 assert.equal(assessOfferMatch('HP laptop',laptop).exactMatch,true);
});


test('v21.2 RED: actual first-ten HP battery and power-supply cards must not masquerade as complete laptops',()=>{
  // Exact titles observed in the independent real Chromium PR #108 candidate
  // at HEAD f03ac1a4, 2026-10-20, browser workflow #39451442245.
  // Customer-visible card samples, not invented merchant fixtures.
  const leaked=[
    'ARyee Laptop Battery Replacement for HP 807956-001 807957-001 HS04 HS03 807612-421 807611-221 240 G4 HSTNN-LB6U',
    'Fegishilly Compatible with HP OmniBook Ultra Flip 2-in-1 14" (14-fh) 2024 Laptop High Transparency Silicone TPU Laptop Keyboard Cover',
    'ARyee Laptop Battery for HP EliteBook 8460p 8460w 8470p 8470w 8560p 8570p HP ProBook 6360b',
    'BIUBOTY TF03XL HT03XL Battery Compatible with HP Pavilion X360 Series',
    'HP 65W USB-C GaN Laptop Power Supply Compatible with HP PCs with USB-C Port - Black'
  ];
  for(const q of ['HP laptop','لابتوب اتش بي']){
    const retained=filterQueryOffers(q,leaked.map(t=>offer(t))).offers;
    assert.deepEqual(retained.map(x=>x.title),[],q+' must not show replacement batteries, keyboard covers or external power supplies');
    for(const title of leaked){
      const o=offer(title);
      assert.equal(productCategory(o),'accessory','category: '+title);
      assert.equal(assessOfferMatch(q,o).exactMatch,false,'false exact: '+title);
    }
  }
  const genuine=offer('HP Pavilion 15 Laptop Intel Core i5 16GB RAM 512GB SSD with 9-hour Battery Life','15eg123');
  assert.equal(productCategory(genuine),'laptop','device battery life must not change primary product type');
  assert.equal(filterQueryOffers('HP laptop',[genuine]).offers.length,1);
});

test('v21.2: explicit HP laptop battery shopping intent retains compatible accessories',()=>{
  const battery=offer('ARyee Laptop Battery Replacement for HP 807956-001 HS04 HS03 240 G4');
  assert.equal(productCategory(battery),'accessory');
  assert.equal(filterQueryOffers('HP laptop battery',[battery]).offers.length,1,
    'explicit accessory intent must not be suppressed by a broad laptop-only guard');
});


test('v21.7 RED: real first-ten truncated Fegishilly HP keyboard cover is not an HP laptop',()=>{
 // 2026-10-20 exact candidate Chromium run #39500689674 (HP EN/AR).
 // Source item Amazon Saudi ASIN B0F8N2Y14P, observed first group SAR96.
 // The customer-visible title is clipped before "Keyboard Cover"; neither
 // a title substring nor a retailer compatibility claim proves a laptop.
 const sourceTitle='Fegishilly Compatible with HP OmniBook Ultra Flip 2-in-1 14" (14-fh) 2024 Laptop High Transparency Silicone TPU Laptop Key...';
 const clipped={
  ...offer(sourceTitle),
  merchant:'Amazon Saudi',
  sourceUrl:'https://www.amazon.sa/-/en/Fegishilly-Compatible-OmniBook-Transparency-Resistant/dp/B0F8N2Y14P/ref=sr_1_223',
  productPrice:96,
  currency:'SAR'
 };
 assert.equal(productCategory(clipped),'accessory','seller accessory subject must outrank laptop family compatibility');
 for(const query of ['HP laptop','لابتوب اتش بي']){
  assert.equal(assessOfferMatch(query,clipped).exactMatch,false,query);
  assert.equal(filterQueryOffers(query,[clipped]).offers.length,0,query);
 }
 const complete=offer('HP OmniBook Ultra Flip Laptop Intel Core Ultra 7 16GB RAM 1TB SSD');
 assert.equal(productCategory(complete),'laptop');
 assert.equal(filterQueryOffers('HP laptop',[complete]).offers.length,1);
});
