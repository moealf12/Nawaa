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

import fc from 'fast-check';
import {assessFirstOfferOwnership,firstOwnershipEligibleOffer} from '../src/search-first-offer-metrics.mjs';
const attested={...base,sku:'IPH17-256',independentlyAttested:true};
const candidate={...base,sku:'IPH17-256'};
test('v21.57: structural validity alone never certifies sellable-item ownership',()=>{
  const result=assessFirstOfferOwnership(candidate);
  assert.equal(result.eligible,false);
  assert.equal(result.state,'CONSISTENT_BUT_UNVERIFIED');
  assert.equal(firstOwnershipEligibleOffer([candidate]),null);
});
test('v21.57: independent same-offer attestation can certify coherent identity',()=>{
  const result=assessFirstOfferOwnership(candidate,attested);
  assert.equal(result.state,'VERIFIED');
  assert.equal(result.eligible,true);
  assert.equal(firstOwnershipEligibleOffer([candidate],()=>attested).offer,candidate);
});
test('v21.57: conflicting image, SKU, URL, currency or merchant never certifies',()=>{
  for(const e of [
    {...attested,sku:'IPH17PRO-512'},
    {...attested,sourceUrl:'https://www.jarir.com/sa-en/other-product.html'},
    {...attested,currency:'USD'},
    {...attested,merchant:'eXtra'},
    {...attested,image:'https://merchant.example/foreign.jpg'},
  ]){
    const offer=e.image?{...candidate,image:'https://merchant.example/phone.jpg'}:candidate;
    const evidence=e.image?{...e,image:'https://merchant.example/foreign.jpg'}:e;
    const result=assessFirstOfferOwnership(offer,evidence);
    assert.equal(result.eligible,false);
    assert.equal(result.state,'CONFLICTING_EVIDENCE');
  }
});
test('v21.57: bounded property checks reject independent price, currency and SKU mutations',()=>{
  fc.assert(fc.property(fc.integer({min:1,max:999999}),fc.constantFrom('USD','AED','EUR'),
    fc.string({minLength:1,maxLength:16}).filter(s=>s!=='IPH17-256'),
    (price,currency,sku)=>{
      const baseEvidence={...attested,productPrice:price,currency,sku};
      const result=assessFirstOfferOwnership(candidate,baseEvidence);
      assert.equal(result.eligible,false);
      assert.equal(result.state,'CONFLICTING_EVIDENCE');
    }),{seed:2157,numRuns:64});
});
test('v21.57: source blocked cannot become certified even with coherent attestation',()=>{
  assert.equal(assessFirstOfferOwnership(candidate,{...attested,sourceBlocked:true}).state,'SOURCE_BLOCKED');
});

import {createFirstOfferTimeline} from '../src/search-first-offer-metrics.mjs';
test('v21.57: per-request milestones reject stale requests and unsupported paint claims',()=>{
  let now=100;
  const timeline=createFirstOfferTimeline(7,()=>now);
  now=110;
  assert.equal(timeline.mark('T1',{requestId:6}),false);
  assert.equal(timeline.mark('T1',{requestId:7}),true);
  now=120;
  assert.equal(timeline.mark('T5',{ownership:{eligible:false}}),false);
  assert.equal(timeline.mark('T5',{ownership:{eligible:true}}),true);
  now=130;
  assert.equal(timeline.mark('T6'),true);
  assert.equal(timeline.mark('T8'),false);
  assert.equal(timeline.mark('T8',{evidence:{independentlyObserved:true}}),true);
  assert.equal(timeline.finish('complete'),true);
  assert.equal(timeline.mark('T7'),false);
  assert.deepEqual(timeline.snapshot().elapsedMs,{T0:0,T1:10,T5:20,T6:30,T8:30});
});
test('v21.57: cancelled searches cannot accrue late measurements',()=>{
  const timeline=createFirstOfferTimeline(2,()=>100);
  assert.equal(timeline.finish('cancelled'),true);
  assert.equal(timeline.mark('T1'),false);
  assert.equal(timeline.snapshot().firstVisibleCertified,false);
});
