import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOfferMatch,filterQueryOffers} from '../src/search-query.mjs';
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