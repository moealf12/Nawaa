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


test('v21.8 RED: recorded Portuguese Capa Nomad iPhone 17 Pro cover is not a handset',()=>{
 const cover={title:'Capa Nomad Back Couro iPhone 17 Pro Preta',merchant:'Recorded merchant',
   sourceUrl:'https://www.amazon.sa/dp/B0FPGDG31T',specs:{},
   condition:'new',availability:'unknown'};
 assert.equal(productCategory(cover),'accessory');
 assert.equal(assessOfferMatch('iPhone 17 Pro',cover).exactMatch,false);
 assert.equal(filterQueryOffers('iPhone 17 Pro',[cover]).offers.length,0);
 const handset={...cover,title:'Apple iPhone 17 Pro 256 GB Cosmic Orange',
   sourceUrl:'https://www.jarir.com/sa-en/apple-iphone-17-pro-smartphones-666722.html'};
 assert.equal(productCategory(handset),'phone');
 assert.equal(assessOfferMatch('iPhone 17 Pro',handset).exactMatch,true);
});

test('v21.20 source-backed first-ten counterfeit device and accessory-subtype guards',async()=>{
 const {describeProduct,parseSearchIntent}=await import('../src/search-query.mjs');
 const make=(title,sourceUrl)=>({
   title,sourceUrl,merchant:'Observed merchant',productPrice:199,
   condition:'new',availability:'unknown',canShipToSaudi:null,specs:{}
 });
 const cases=[
   ['PS5 Slim',
    make('PEYANZ Protective Dissipation Scratch Resistant Installation for PS5 Slim Digital Edition',
      'https://www.amazon.sa/-/en/PEYANZ-Protective-Dissipation-Scratch-Resistant-Installation/dp/B0CZL8886V/ref=sr_1_109')],
   ['iPhone 17 Pro Max',
    make('PanzerGlass CARE 3-in-1 Explorer Bundle Transparent iPhone 17 Pro Max',
      'https://saudi.sharafdg.com/en/product/panzerglass-care-3-in-1-explorer-bundle-transparent-iphone-17-pro-max-pnzcr94434/')],
   ['HP printer',
    make('HP Printer Paper 8.5 x 11 Premium 28 lb 500 Sheets',
      'https://www.amazon.sa/-/en/HP-Printer-Paper-Premium-Ream/dp/B00RUKC3PI/ref=sr_1_177')],
   ['PS5 Slim',
    make('Hzxkqmil Replacement Side Shell with Cooling Vents Anti-Scratch Accessories for PS5 Slim Console Disc Edition',
      'https://www.amazon.sa/-/en/Hzxkqmil-Replacement-Ventilation-Anti-Scratch-Accessories/dp/B0DKNVSGSM/ref=sr_1_178')]
 ];
 for(const [query,offer] of cases){
   assert.equal(productCategory(offer),'accessory',offer.title);
   assert.equal(assessOfferMatch(query,offer).exactMatch,false,offer.title);
   assert.equal(filterQueryOffers(query,[offer]).offers.length,0,offer.title);
 }
 const thirdPartyToner=make('Skydo H207A For HP Color LaserJet Pro MFP M283fdw M282nw W2211A W2210X',
   'https://www.amazon.sa/-/en/Skydo-207A-H207A/dp/B0DDPWLL4J/ref=sr_1_144');
 assert.equal(filterQueryOffers('HP printer',[thirdPartyToner]).offers.length,0,
   'compatible third-party toner must not appear as an HP printer');
 const internalDriveModule=make('Gorliskl Blu-Ray DVD Optical Disc Drive Connector Module Replacement for Sony PlayStation 5 PS5 KEM-497AAA',
   'https://www.amazon.sa/-/en/Gorliskl-Connector-Replacement-PlayStation-KEM-497AAA/dp/B0F29BN21J/ref=sr_1_46');
 assert.equal(filterQueryOffers('PS5 disc drive',[internalDriveModule]).offers.length,0,
   'internal replacement connector is not the complete standalone PS5 add-on drive');
 const internalDriveUnit=make('DVD Optical Disc Drive Module for Sony PS5 KEM-497AAA CFI-1215A 1200 only',
   'https://www.amazon.sa/-/en/Optical-Drive-Module-KEM-497AAA-1215A/dp/B0CJ8SM93K/ref=sr_1_35');
 assert.equal(filterQueryOffers('PS5 disc drive',[internalDriveUnit]).offers.length,0,
   'repair drive module is distinct from a complete external add-on disc drive');
 const ink=make('HP GT52 M0H54AE Cyan Original Ink Bottle',
   'https://saudi.sharafdg.com/en/product/hp-gt52-m0h54ae-cyan-original-ink-bottle/');
 assert.equal(filterQueryOffers('HP mouse',[ink]).offers.length,0,
   'accessory category is too broad: ink is not a mouse');
 const cable=make('Blu-Ray Optical Disc Drive 4Pin Power Cable for Sony PlayStation PS5',
   'https://www.amazon.sa/-/en/Blu-Ray-Optical-Drive-Power-PlayStation/dp/B0DCYX7YFB/ref=sr_1_87');
 assert.equal(filterQueryOffers('PS5 disc drive',[cable]).offers.length,0,
   'disc-drive power cable cannot be sold as a complete disc drive');
 assert.equal(parseSearchIntent('iPhone 17 Pro capinha').category,'accessory',
   'Portuguese capinha denotes a phone case, not a handset');
 // Explicitly protect genuine primary devices and exact accessories.
 const good=[
   ['PS5 Slim',make('Sony PlayStation 5 PS5 Slim Digital Edition Console 825GB','https://www.bestbuy.com/product/ps5-slim')],
   ['iPhone 17 Pro Max',make('Apple iPhone 17 Pro Max 256 GB Cosmic Orange','https://www.jarir.com/sa-en/apple-iphone-17-pro-max-smartphones-666736.html')],
   ['HP printer',make('HP DeskJet 2320 All-in-One Printer','https://www.jarir.com/sa-en/hp-printer.html')],
   ['HP mouse',make('HP 1000 Wired Mouse Black','https://www.extra.com/en-sa/p/100186745')],
   ['PS5 disc drive',make('Sony Disc Drive for PlayStation 5 Digital Edition Slim','https://www.jarir.com/sa-en/sony-digital-edition-slim-other-gaming-accessories-629492.html')]
 ];
 for(const [query,offer] of good)assert.equal(assessOfferMatch(query,offer).exactMatch,true,
   'valid sellable item must remain exact for '+query);
 // More specific accessory searches remain distinct from generic device intent.
 assert.equal(parseSearchIntent('HP printer paper').category,'accessory');
 assert.equal(assessOfferMatch('HP printer paper',cases[2][1]).exactMatch,true,
   'printer paper is relevant only when specifically requested');
 assert.equal(assessOfferMatch('PS5 disc drive power cable',cable).exactMatch,true,
   'explicit cable intent must not be suppressed by the disc-drive guard');
 assert.equal(describeProduct(good[0][1]).kind,'console');
});


test('v21.21 source-backed retail-subject distinction for PS5 heatsink and German HP ink',()=>{
  // Recorded source URLs + identifying product descriptions from the v21.20
  // first-ten manual audit. Amazon's live PDP content was not independently
  // retrievable; these are deterministic counterexamples, NOT raw-PDP captures.
  const source=(title,sourceUrl,brand='')=>({
    title,sourceUrl,merchant:'Amazon Saudi',productPrice:139,
    currency:'SAR',condition:'new',availability:'unknown',
    specs:{brand},canShipToSaudi:null
  });
  const heatsink=source(
    'M.2 Heatsink Compatible with PS5 Slim Digital Edition, Aluminum Heat Sink for Console',
    'https://www.amazon.sa/-/en/spring-Heatsink-Compatible-Digital-Aluminum/dp/B0FMYJCSK7/ref=sr_1_142');
  const cartridge=source(
    'HP 912XL (3YL82AE) Multipack Original Druckerpatronen mit hoher Reichweite (für HP Officejet Pro)',
    'https://www.amazon.sa/-/en/HP-3YL82AE-Multipack-Druckerpatronen-Reichweite/dp/B07RVXV1XH/ref=sr_1_75','HP');
  const originals=structuredClone([heatsink,cartridge]);
  assert.equal(productCategory(heatsink),'accessory');
  assert.equal(assessOfferMatch('PS5 Slim',heatsink).exactMatch,false);
  assert.deepEqual(filterQueryOffers('PS5 Slim',[heatsink]).offers,[]);
  assert.equal(productCategory(cartridge),'accessory');
  assert.equal(assessOfferMatch('HP printer',cartridge).exactMatch,false);
  assert.deepEqual(filterQueryOffers('HP printer',[cartridge]).offers,[]);
  assert.equal(assessOfferMatch('PS5 Slim heatsink',heatsink).exactMatch,true,
    'explicit heatsink intent for the compatible Slim model must remain exact');
  assert.equal(filterQueryOffers('PS5 Slim heatsink',[heatsink]).offers.length,1);
  assert.equal(assessOfferMatch('HP Druckerpatronen',cartridge).exactMatch,true,
    'explicit German cartridge intent must remain discoverable');
  assert.equal(filterQueryOffers('HP Druckerpatronen',[cartridge]).offers.length,1);
  // Genuine complete devices and truly included accessories must remain exact.
  const realPs5=source('PS5 Slim Digital Edition Console 825GB with included heatsink',
    'https://www.bestbuy.com/product/playstation-5-slim-digital-edition-console-825gb/JXHQ37TYYL/sku/6646420');
  const realPrinter=source('HP DeskJet 2320 Printer with included ink cartridges',
    'https://saudi.sharafdg.com/en/product/hp-deskjet-2320-7wn42b-all-in-one-printer/','HP');
  assert.equal(productCategory(realPs5),'console');
  assert.equal(assessOfferMatch('PS5 Slim',realPs5).exactMatch,true);
  assert.equal(productCategory(realPrinter),'printer');
  assert.equal(assessOfferMatch('HP printer',realPrinter).exactMatch,true);
  assert.deepEqual([heatsink,cartridge],originals,'raw merchant offer data must not be mutated');
});


test('v21.22 held-out retail-subject relationships: compatible component never becomes its target',()=>{
  // SYNTHETIC METAMORPHIC HOLDOUTS — not claimed as live merchant observations.
  // New category families are kept separate from previous PS5/iPhone/HP examples.
  const mk=title=>({title,merchant:'Synthetic relationship holdout',sourceUrl:'https://example.org/fixture',
    productPrice:500,currency:'SAR',condition:'new',availability:'unknown',specs:{}});
  const components=[
    {query:'Sony camera',title:'Camera Lens for Sony Alpha Mirrorless Camera'},
    {query:'Apple Watch',title:'Replacement Strap for Apple Watch Series 10'},
    {query:'Dyson vacuum',title:'Replacement Filter for Dyson V12 Vacuum Cleaner'},
    {query:'Nespresso coffee maker',title:'Coffee Capsules for Nespresso Coffee Maker'}
  ];
  const explicitAccessoryQueries=[
    'Sony camera lens','Apple Watch strap','Dyson vacuum filter','Nespresso coffee capsules'
  ];
  for(const {query,title} of components){
    const offer=mk(title),raw=structuredClone(offer);
    assert.equal(productCategory(offer),'accessory','sold component not compatible device: '+title);
    assert.equal(assessOfferMatch(query,offer).exactMatch,false,'cannot exact-match device: '+title);
    assert.equal(filterQueryOffers(query,[offer]).offers.length,0,'cannot promote component: '+title);
    const explicit=explicitAccessoryQueries[components.findIndex(x=>x.title===title)];
    assert.equal(assessOfferMatch(explicit,offer).exactMatch,true,
      'explicit part search must retain exact accessory: '+explicit);
    assert.equal(filterQueryOffers(explicit,[offer]).offers.length,1,
      'generalization must not destroy explicit-part recall: '+explicit);
    assert.deepEqual(offer,raw,'must preserve raw evidence');
  }
  const realSubjects=[
    {title:'Sony Alpha Mirrorless Camera with Included Lens',category:'camera'},
    {title:'Apple Watch Series 10 with Included Strap',category:'watch'},
    {title:'Dyson V12 Vacuum Cleaner with Included Filter',category:'vacuum'}
  ];
  for(const {title,category} of realSubjects)
    assert.equal(productCategory(mk(title)),category,'true device bundle stays complete: '+title);
});
