import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOfferMatch,filterQueryOffers,queryMatchReasons,parseSearchIntent,productCategory} from '../src/search-query.mjs';
const base={merchant:'eXtra',sourceUrl:'https://www.extra.com/en-sa/item/1',productPrice:2499,
  currency:'SAR',observedAt:'2026-10-16T00:00:00Z',condition:'new'};
const consoleOffer={...base,title:'Sony PS5 Console Disc Edition 1TB'};
const driveOffer={...base,sourceUrl:'https://www.extra.com/en-sa/item/2',title:'PS5 Disc Drive accessory for Digital Edition'};
const iphone={...base,sourceUrl:'https://www.extra.com/en-sa/item/3',title:'Apple iPhone 17 256GB Black'};
const caseOffer={...base,sourceUrl:'https://www.extra.com/en-sa/item/4',title:'Protective Case for Apple iPhone 17 256GB'};
test('PS5 console and separate disc-drive identities remain distinct',()=>{
  assert.equal(assessOfferMatch('PS5',consoleOffer).productKind,'console');
  assert.equal(assessOfferMatch('PS5',driveOffer).exactMatch,false);
  assert.ok(assessOfferMatch('PS5',consoleOffer).matchConfidence>assessOfferMatch('PS5',driveOffer).matchConfidence);
  assert.ok(filterQueryOffers('PS5',[consoleOffer,driveOffer]).offers.some(o=>o.sourceUrl===consoleOffer.sourceUrl));
  assert.ok(!filterQueryOffers('PS5',[consoleOffer,driveOffer]).offers.some(o=>o.sourceUrl===driveOffer.sourceUrl));
});
test('unrequested phone accessories remain demoted across repeated Arabic and English requests',()=>{
  for(const query of ['iPhone 17','ايفون 17']){
    for(let round=0;round<4;round++){
      const a=assessOfferMatch(query,iphone),b=assessOfferMatch(query,caseOffer);
      assert.ok(a.matchConfidence>b.matchConfidence);
      assert.equal(b.exactMatch,false);
      assert.equal(filterQueryOffers(query,[iphone,caseOffer]).offers.some(o=>o.sourceUrl===caseOffer.sourceUrl),false);
    }
  }
});
test('search matching does not mutate offer provenance or observed time',()=>{
  const input=[consoleOffer,driveOffer,iphone,caseOffer];
  const original=input.map(x=>structuredClone(x));
  for(const query of ['PS5','iPhone 17','ايفون 17 256 جيجا']){
    filterQueryOffers(query,input);
    input.forEach(x=>assessOfferMatch(query,x));
  }
  assert.deepStrictEqual(input,original);
});

test('batch-shared intent has identical decisions to independent matching for every offer',()=>{
  const items=[consoleOffer,driveOffer,iphone,caseOffer,
    {...base,title:'Samsung Galaxy S25 Ultra 256GB',sourceUrl:'https://example.com/galaxy'},
    {...base,title:'HP Laptop 16GB RAM',sourceUrl:'https://example.com/laptop'},
    {...base,title:'iPhone 17 Pro Max 512GB',sourceUrl:'https://example.com/promax'}];
  for(const query of ['PS5','PS5 disc drive','iPhone 17','iPhone 17 Pro Max',
    'ايفون 17 256 جيجا','HP laptop','Samsung Galaxy S25 Ultra 256GB','Nike','']){
    const expected=items.filter(item=>queryMatchReasons(query,item).length===0);
    const actual=filterQueryOffers(query,items);
    assert.deepStrictEqual(actual.offers,expected,'same accepted sources: '+query);
    assert.equal(actual.queryFilter.input,items.length);
    assert.equal(actual.queryFilter.retained,expected.length);
  }
});

test('interleaved batches preserve matching for previous queries',()=>{
  const items=[consoleOffer,driveOffer,iphone,caseOffer];
  const ps5=filterQueryOffers('PS5',items);
  const phone=filterQueryOffers('iPhone 17',items);
  for(let i=0;i<5;i++){
    assert.deepStrictEqual(filterQueryOffers('PS5',items),ps5);
    assert.deepStrictEqual(filterQueryOffers('iPhone 17',items),phone);
  }
});

test('empty provider batches retain their zero-result contract',()=>{
  assert.deepStrictEqual(filterQueryOffers('PS5',[]),
    {offers:[],queryFilter:{input:0,retained:0,removed:0}});
});

test('capacity mismatches remain enforced while unrequested capacities are not',()=>{
  const exact={...iphone,specs:{storage:'256GB'}};
  const different={...iphone,title:'Apple iPhone 17 512GB Black',specs:{storage:'512GB'}};
  assert.equal(queryMatchReasons('iPhone 17 256GB',exact).includes('capacity_conflict'),false);
  assert.equal(queryMatchReasons('iPhone 17 256GB',different).includes('capacity_conflict'),true);
  assert.equal(queryMatchReasons('iPhone 17',different).includes('capacity_conflict'),false);
  assert.equal(queryMatchReasons('ايفون 17 256 جيجا',different).includes('capacity_conflict'),true);
  assert.equal(queryMatchReasons('iPhone 17 256GB',exact).includes('model_conflict'),false);
});
test('model and storage constraints remain isolated across alternating batches',()=>{
  const items=[
    {...iphone,title:'Apple iPhone 17 256GB',specs:{storage:'256 GB',deviceType:'iPhone 17'}},
    {...iphone,title:'Apple iPhone 17 Pro 512GB',specs:{storage:'512GB',deviceType:'iPhone 17 Pro'}},
    {...iphone,title:'Apple iPhone 17 Case for 256GB',specs:{storage:'256GB'}},
  ];
  const initial=items.map(item=>structuredClone(item));
  for(let n=0;n<4;n++){
    const exact=filterQueryOffers('iPhone 17 256GB',items);
    filterQueryOffers('iPhone 17 Pro 512GB',items);
    filterQueryOffers('iPhone 17',items);
    assert.ok(exact.offers.every(x=>!queryMatchReasons('iPhone 17 256GB',x).length));
    assert.ok(!exact.offers.some(x=>x.title.includes('Pro')));
    assert.deepStrictEqual(items,initial);
  }
});

test('direct public matching with and without prepared intent is identical',()=>{
  const offers=[consoleOffer,driveOffer,iphone,caseOffer,
    {...iphone,sourceUrl:'https://example.com/iphone-pro',title:'iPhone 17 Pro 512GB Black',specs:{storage:'512GB',deviceType:'iPhone 17 Pro'}},
    {...consoleOffer,sourceUrl:'https://example.com/pad',title:'PS5 Wireless Controller'}];
  for(const query of ['PS5','PS5 disc drive','iPhone 17 256GB','ايفون 17 256 جيجا',
    'Samsung Galaxy S25 Ultra 256GB','HP laptop','Nike','Logitech mouse','','PS5 DualSense controller']){
    const parsed=parseSearchIntent(query);
    for(const offer of offers){
      assert.deepStrictEqual(assessOfferMatch(query,offer),assessOfferMatch(query,offer,parsed),query);
      assert.deepStrictEqual(queryMatchReasons(query,offer),queryMatchReasons(query,offer,parsed),query);
    }
    const expected=offers.filter(offer=>queryMatchReasons(query,offer).length===0);
    assert.deepStrictEqual(filterQueryOffers(query,offers).offers,expected,query);
  }
});


test('public product category contract preserves console and device/accessory distinction',()=>{
  const cases=[
    [consoleOffer,'console'],
    [driveOffer,'accessory'],
    [iphone,'phone'],
    [caseOffer,'accessory'],
  ];
  for(const [offer,kind] of cases){
    assert.equal(productCategory(offer),kind,offer.title);
    const snapshot=structuredClone(offer);
    for(const q of ['PS5','iPhone 17','Sony','Apple']){
      assessOfferMatch(q,offer);
      assert.equal(productCategory(offer),kind);
    }
    assert.deepStrictEqual(offer,snapshot);
  }
});
