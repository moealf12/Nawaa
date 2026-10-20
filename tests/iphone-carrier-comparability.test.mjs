import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOfferMatch,filterQueryOffers,queryMatchReasons} from '../src/search-query.mjs';

// REAL_REPLAY: first-ten titles and URLs captured on PR #108 Chromium
// run #39454522737, historical exact HEAD 32aa2da3, 2026-10-20.
// Best Buy's independently inspected PDPs explicitly identify carrier AT&T or
// Verizon, with carrier-specific activation/payment options. This does NOT
// establish whether either phone is SIM-locked or can ship to Saudi Arabia.
// The supported claim is narrower: carrier-specific contract variants must not
// masquerade as generally comparable unlocked iPhones for Saudi-first search.
const carrierItems=[
  ['Apple - iPhone 17 256GB - Black (AT&T)', 'https://www.bestbuy.com/product/apple-iphone-17-256gb-black-at-t/JCQ6HRFQT6/sku/6443168'],
  ['Apple - iPhone 17 256GB - Sage (Verizon)', 'https://www.bestbuy.com/product/apple-iphone-17-256gb-sage-verizon/JCQ6HRFQ2W/sku/6443134'],
  ['Apple - iPhone 17 512GB - White (Verizon)', 'https://www.bestbuy.com/product/apple-iphone-17-512gb-white-verizon/JCQ6HRFQXV/sku/6443137'],
];
const make=(title,sourceUrl,countryCode='US')=>({
  title,sourceUrl,merchant:'Best Buy',merchantCountryCode:countryCode,
  providerMarket:'bestbuy-us',canShipToSaudi:null,condition:'new',
  availability:'unknown',productPrice:3487.46,specs:{brand:'Apple'},
});

test('v21.4 RED: real carrier-specific US iPhone 17 is not exact Saudi-first generic iPhone',()=>{
  const offers=carrierItems.map(([title,url])=>make(title,url));
  for(const item of offers){
    const result=assessOfferMatch('iPhone 17',item);
    assert.equal(result.exactMatch,false,item.title);
    assert.ok(result.matchConfidence<0.65,'generic device filter must not promote a carrier-plan variant: '+item.title);
    assert.ok(queryMatchReasons('iPhone 17',item).includes('query_mismatch'),item.title);
  }
  assert.equal(filterQueryOffers('iPhone 17',offers).offers.length,0);
});

test('v21.4: genuinely generic Saudi iPhone and explicitly unlocked devices remain discoverable',()=>{
  const sa=make('Apple iPhone 17 256GB Black',
    'https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html','SA');
  const unlocked=make('Apple - iPhone 17 256GB - Black (Unlocked)',
    'https://www.bestbuy.com/product/apple-iphone-17-256gb-black-unlocked/sku/0000000');
  assert.equal(assessOfferMatch('iPhone 17',sa).exactMatch,true);
  assert.equal(assessOfferMatch('iPhone 17',unlocked).exactMatch,true);
  assert.equal(filterQueryOffers('iPhone 17',[sa,unlocked]).offers.length,2);
});

test('v21.4: explicit US carrier-specific iPhone intent remains available as a separate variant',()=>{
  const phone=make(...carrierItems[0]);
  const result=assessOfferMatch('iPhone 17 AT&T',phone);
  assert.equal(result.exactMatch,true,'explicit carrier intent remains supported');
  assert.equal(filterQueryOffers('iPhone 17 AT&T',[phone]).offers.length,1);
});
