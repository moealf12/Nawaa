import test from 'node:test';
import assert from 'node:assert/strict';
import {describeProduct,productCategory,assessOfferMatch,filterQueryOffers} from '../src/search-query.mjs';

// Real browser-observed merchant title and shown price; source link is intentionally
// a fixture, NOT a fabricated eBay listing URL or independent price attestation.
const observedFaceplate={
  title:'Faceplates PS5 Side Shell Plates PlayStation 5 Slim Disc Edition Black + LEDs',
  merchant:'eBay',providerMarket:'EBAY_US',productPrice:110.33,currency:'SAR',
  sourceUrl:'https://fixture.example/ps5-faceplate',condition:'new',
  specs:{},observedAt:'2026-10-26T00:00:00.000Z'
};
const genuine={
  title:'Sony PS5 Slim Disc Edition Console 1TB',
  merchant:'Jarir',sourceUrl:'https://fixture.example/genuine-console',
  productPrice:2499,currency:'SAR',condition:'new',specs:{storage:'1TB'},
  observedAt:'2026-10-26T00:00:00.000Z'
};

test('P0: browser-observed PS5 Slim Disc eBay faceplates are accessories, never a console offer',()=>{
  const copy=structuredClone(observedFaceplate);
  assert.equal(describeProduct(observedFaceplate).kind,'accessory');
  assert.equal(productCategory(observedFaceplate),'accessory');
  for(const q of ['PS5','PS5 Slim','PS5 Slim Disc']){
    const m=assessOfferMatch(q,observedFaceplate);
    assert.equal(m.exactMatch,false,q);
    assert.ok(m.matchConfidence<0.65,q+': '+m.matchConfidence);
    assert.deepEqual(filterQueryOffers(q,[observedFaceplate]).offers,[]);
  }
  assert.deepEqual(observedFaceplate,copy,'classification must not mutate merchant evidence');
});

test('P0: adjacent PS5 faceplate, side-shell, skin and LED panel variants stay accessories',()=>{
  const peripheralTitles=[
    'PS5 Slim Disc Edition Faceplate Replacement Black',
    'PS5 Slim Disc Edition Side Shell Plates LED Lighting',
    'Protective Face Plate Skin for PlayStation 5 Slim Console',
    'PS5 Slim Disc Console Replacement Shell Cover',
  ];
  for(const title of peripheralTitles){
    const x={...observedFaceplate,title};
    assert.equal(productCategory(x),'accessory',title);
    assert.equal(assessOfferMatch('PS5 Slim Disc',x).exactMatch,false,title);
    assert.equal(filterQueryOffers('PS5 Slim Disc',[x]).offers.length,0,title);
  }
});

test('P0 positive: a real PS5 Slim Disc console remains an exact comparison offer',()=>{
  assert.equal(describeProduct(genuine).kind,'console');
  assert.equal(productCategory(genuine),'console');
  assert.equal(assessOfferMatch('PS5 Slim Disc',genuine).exactMatch,true);
  assert.equal(filterQueryOffers('PS5 Slim Disc',[observedFaceplate,genuine]).offers.length,1);
});

test('P0 positive: a console sold WITH an included faceplate stays a console bundle',()=>{
  const bundle={...genuine,title:'Sony PS5 Slim Disc Edition Console 1TB with Faceplate Bundle'};
  assert.equal(describeProduct(bundle).kind,'console');
  assert.equal(productCategory(bundle),'console');
  assert.equal(assessOfferMatch('PS5 Slim Disc',bundle).exactMatch,true);
});
