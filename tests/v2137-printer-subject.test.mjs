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
