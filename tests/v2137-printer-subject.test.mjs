import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOfferMatch, filterQueryOffers} from '../src/search-query.mjs';

const offer=(title,url='https://www.amazon.sa/-/en/sample/dp/B0TEST1234')=>({title,sourceUrl:url,merchant:'Amazon Saudi',brand:'HP',price:59,currency:'SAR'});
test('v21.37 RED: HP 305 ink multipack listing must not be promoted as HP printer',()=>{
 const consumable=offer('HP 305 Original Black Multipack Including: DeskJet 2710 2720 2721 2722 DeskJet Plus 4110 4120 4122 4130 Envy 6010','https://www.amazon.sa/-/en/HP-Original-Black-Multipack/dp/B0TEST1234');
 const printer=offer('HP DeskJet 2320 All-in-One Printer','https://www.example.com/hp-deskjet-2320-printer');
 const selected=filterQueryOffers('HP printer',[printer,consumable]).offers;
 assert.ok(selected.includes(printer),'retain actual printer');
 assert.ok(!selected.includes(consumable),'reject an ink consumable that lists compatible printers');
 assert.ok(assessOfferMatch('HP ink',consumable).matchConfidence>0,'explicit consumable searches remain eligible for relevance evaluation');
});

test('v21.37 adversarial printer retail-subject boundaries and intent inversion',()=>{
  const deviceTitles=[
    'HP DeskJet 2320 All-in-One Printer',
    'HP LaserJet M111w Wireless Printer',
    'HP OfficeJet Pro 8015 Printer with Starter Ink',
    'HP Smart Tank 580 Printer including two starter ink bottles',
    'HP DeskJet 2320 Printer Bundle with ink cartridges',
  ];
  const parts=[
    'HP 305 Original Black Multipack Including: DeskJet 2710 2720 2721 2722',
    'HP 305XL Original Ink Cartridge for HP DeskJet 2700 printers',
    'HP 142A Toner Cartridge Compatible With HP LaserJet M110w',
    'HP LaserJet Printer Paper 500 Sheets',
    'HP LaserJet M111w Drum Unit Replacement',
    'HP DeskJet 2720 Paper Tray Replacement',
  ];
  for (const query of ['HP printer','طابعة HP']) {
    const passed=filterQueryOffers(query,[...deviceTitles,...parts].map(offer)).offers;
    for (const title of deviceTitles)
      assert.ok(passed.some(item=>item.title===title),query+' must retain sellable printer: '+title);
    for (const title of parts)
      assert.ok(!passed.some(item=>item.title===title),query+' must reject consumable/part: '+title);
  }
  const ink=offer('HP 305XL Original Ink Cartridge for HP DeskJet 2700 printers');
  const toner=offer('HP 142A Toner Cartridge Compatible With HP LaserJet M110w');
  assert.ok(filterQueryOffers('HP ink',[ink]).offers.length>0,'explicit HP ink searches retain cartridges');
  assert.ok(filterQueryOffers('HP toner',[toner]).offers.length>0,'explicit HP toner searches retain toner');
});
