import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOfferMatch, productCategory, queryMatchReasons, filterQueryOffers } from '../src/search-query.mjs';

// Merchant-observed title text, but synthetic URL and price. No actual live
// Virgin PDP attestation or fabricated purchase destination.
const genuine = [
  'Shop for Apple Watch Ultra 4 GPS + Cellular 49mm Black Titanium Case with Black Titanium Milanese Loop - M | Virgin Megastore UAE',
  'Shop for Apple Watch Series 12 GPS 46mm Space Grey Aluminium Case with Navy Blue Sport Band - S/M | Virgin Megastore UAE',
  'Shop for Apple Watch Ultra 4 GPS + Cellular 49mm Natural Titanium Case with Natural Titanium Milanese Loop | Virgin Megastore UAE',
];
const accessories = [
  'Protective Case for Apple Watch Ultra 4 49mm Black Titanium',
  'Apple Watch Ultra 4 GPS 49mm Titanium Case with Screen Protector',
  'Apple Watch Ultra 4 GPS 49mm Titanium Case with Milanese Loop Replacement Cover',
  'Replacement Watch Strap and Case for Apple Watch Series 12 GPS 46mm',
  'Case for Apple Watch Ultra 4 GPS 49mm with Metal Band',
];

const offer = title => ({
  title, merchant:'synthetic-test-merchant',
  sourceUrl:'https://fixture.example/watch-subject-truth',
  productPrice:2000, currency:'SAR', condition:'new', specs:{}
});

test('RED: actual watch chassis material "Case with Sport Band" is a complete Apple Watch, not a protective accessory', () => {
  for (const title of genuine) {
    const item=offer(title);
    const copy=structuredClone(item);
    assert.equal(productCategory(item),'watch',title);
    const match=assessOfferMatch('Apple Watch',item);
    assert.ok(match.matchConfidence >= 0.65, JSON.stringify({title,match}));
    assert.deepEqual(queryMatchReasons('Apple Watch',item),[],title);
    assert.deepEqual(item,copy,'classification must not modify source data');
  }
});

test('negative controls: protective cases, covers and replacement straps never satisfy a complete-watch query', () => {
  for (const title of accessories) {
    const item=offer(title);
    assert.notEqual(productCategory(item),'watch',title);
    assert.ok(queryMatchReasons('Apple Watch',item).includes('query_mismatch'),title);
  }
});

test('generic Apple Watch discovery retains genuine different watch families and rejects compatible accessories', () => {
  const items=[...genuine.map(offer),...accessories.map(offer)];
  const results=filterQueryOffers('Apple Watch',items);
  assert.equal(results.queryFilter.input,items.length);
  assert.equal(results.queryFilter.retained,genuine.length);
  assert.deepEqual(results.offers.map(item=>item.title),genuine);
});

test('separate PS5 faceplates remain accessories independent of Apple Watch matching', () => {
  const item=offer('Faceplates PS5 Side Shell Plates PlayStation 5 Slim Disc Edition Black + LEDs');
  assert.equal(productCategory(item),'accessory');
  assert.ok(queryMatchReasons('PS5 Slim Disc',item).length>0);
});
