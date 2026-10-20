import test from 'node:test';
import assert from 'node:assert/strict';
import {productCategory,assessOfferMatch,filterQueryOffers} from '../src/search-query.mjs';

// RECORDED_REAL_REPLAY — exact shopper-visible group titles from isolated
// Chromium on PR #108 HEAD ec785ee5 run #39461330015 (2026-10-20).
// They are *not* physical phones. Their current AliExpress source link
// points to a generic BundleDeals2 page (separate provenance defect).
const leaked=[
  'Adaptador de Carga Rápida de IOS a USB C, Adaptador Lightning a Tipo C, Convertidor de Transferencia de Datos USB C para iPhone 17, 15, Samsung, Google',
  'Cargador USB tipo C de 150W, adaptador de viaje para cargador de teléfono móvil de carga rápida QC3.0 para iPhone 17, Samsung, Xiaomi, enchufe UE/REINO UNIDO/EE. UU.',
];
const make=(title)=>({title,merchant:'AliExpress',providerMarket:'aliexpress-cn',
  sourceUrl:'https://www.aliexpress.com/ssr/300000512/BundleDeals2',
  productPrice:23.93,condition:'new',availability:'unknown',
  canShipToSaudi:null,specs:{brand:'Apple'}});

test('v21.4 P0 RED: observed Spanish charger and adapter cannot exact-match the iPhone 17 device',()=>{
  const candidates=leaked.map(make);
  for(const item of candidates){
    assert.equal(productCategory(item),'accessory',item.title);
    assert.equal(assessOfferMatch('iPhone 17',item).exactMatch,false,item.title);
  }
  assert.deepEqual(filterQueryOffers('iPhone 17',candidates).offers,[]);
});

test('v21.4: an actual phone with included charger does not become a standalone charger',()=>{
  const phone=make('Apple iPhone 17 256GB con cargador incluido');
  phone.merchant='Jarir';
  phone.sourceUrl='https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html';
  assert.equal(productCategory(phone),'phone');
  assert.equal(assessOfferMatch('iPhone 17',phone).exactMatch,true);
  assert.equal(filterQueryOffers('iPhone 17',[phone]).offers.length,1);
});

test('v21.4: a Spanish accessory remains an accessory even without the compatible iPhone keyword',()=>{
  const accessory=make('Cargador USB tipo C de 150W de viaje');
  assert.equal(productCategory(accessory),'accessory');
});


test('v21.4 P0 RED: real Amazon compatibility-only iPhone kit cannot exact-match the phone',()=>{
  // RECORDED_REAL_REPLAY from isolated candidate Chromium #39462564830 on HEAD a22f141d.
  // Visible result was X-LEADER travel protection kit, SAR159.85; not iPhone handset.
  const item={
    title:'X-LEADER Travel iPhone Protection Kit | For iPhone 17/16/15/14, Leather Bag & Warranty (IPH16PROMAX)',
    merchant:'Amazon Saudi',providerMarket:'amazon-sa',
    sourceUrl:'https://www.amazon.sa/-/en/X-LEADER-Protection-Leather-Warranty-IPH16PROMAX/dp/B0FSY5PQ5Y/ref=sr_1_184',
    condition:'new',availability:'unknown',productPrice:159.85,
    canShipToSaudi:true,specs:{}
  };
  assert.equal(productCategory(item),'accessory','compatibility does not prove the sold item is a phone');
  assert.equal(assessOfferMatch('iPhone 17',item).exactMatch,false);
  assert.equal(filterQueryOffers('iPhone 17',[item]).offers.length,0);
  const genuine={...item,title:'Apple iPhone 17 256 GB Black',sourceUrl:'https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html',merchant:'Jarir'};
  assert.equal(productCategory(genuine),'phone');
  assert.equal(assessOfferMatch('iPhone 17',genuine).exactMatch,true);
  assert.equal(filterQueryOffers('iPhone 17',[genuine]).offers.length,1);
});
