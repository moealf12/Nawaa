import test from 'node:test';
import assert from 'node:assert/strict';
import {firstOfferMilestones,structurallyValidOffer} from '../src/search-first-offer-metrics.mjs';
const base={title:'Apple iPhone 17 256GB Black',productPrice:3499,currency:'SAR',
  merchant:'Jarir',providerMarket:'jarir-sa',
  sourceUrl:'https://www.jarir.com/sa-en/iphone-17.html',
  observedAt:'2026-10-16T12:00:00.000Z'};
test('first structurally valid offer and first exact product are different milestones',()=>{
  const invalid={...base,sourceUrl:'http://example.com/product',exactMatch:true};
  const related={...base,exactMatch:false};
  const exact={...base,merchant:'eXtra',providerMarket:'extra-sa',exactMatch:true};
  const input=structuredClone([invalid,related,exact]);
  const result=firstOfferMilestones(input);
  assert.equal(result.firstValid,input[1]);
  assert.equal(result.firstExact,input[2]);
  assert.equal(result.validCount,2);
  assert.equal(result.exactCount,1);
  assert.deepStrictEqual(input,[invalid,related,exact]);
});
test('absent exact or zero valid offers report null, not false success',()=>{
  assert.deepStrictEqual(firstOfferMilestones([{...base,exactMatch:false}]).firstExact,null);
  assert.deepStrictEqual(firstOfferMilestones([{...base,merchant:'App',exactMatch:true}]),{
    firstValid:null,firstExact:null,validCount:0,exactCount:0,
  });
  assert.deepStrictEqual(firstOfferMilestones(null),{
    firstValid:null,firstExact:null,validCount:0,exactCount:0,
  });
});
test('malformed prices timestamps and source URLs cannot become exact winners',()=>{
  for(const item of [
    {...base,productPrice:NaN},
    {...base,productPrice:0},
    {...base,currency:'USD'},
    {...base,observedAt:'not-a-date'},
    {...base,sourceUrl:'javascript:alert(1)'},
    {...base,merchant:''},
    {...base,title:''},
  ]) {
    assert.equal(structurallyValidOffer({...item,exactMatch:true}),false);
  }
});
test('Arabic, broad and accessory offers respect exact flag, not title guesses',()=>{
  const offers=[
    {...base,title:'ايفون 17 كفر حماية',merchant:'Jarir',exactMatch:false},
    {...base,title:'Apple iPhone 17 256GB Black',merchant:'eXtra',exactMatch:true},
  ];
  const result=firstOfferMilestones(offers);
  assert.equal(result.firstValid.title,'ايفون 17 كفر حماية');
  assert.equal(result.firstExact.merchant,'eXtra');
});
