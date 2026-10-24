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
    {...base,sourceUrl:'https://user:pass@www.jarir.com/sa-en/iphone-17.html'},
    {...base,sourceUrl:'https://'},
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
test('v21.60: merchant-like and caller-supplied attestation cannot certify coherent identity',()=>{
  const mirror={...candidate,independentlyAttested:true};
  for(const evidence of [attested,mirror,{...candidate}]){
    const result=assessFirstOfferOwnership(candidate,evidence);
    assert.equal(result.state,'CONSISTENT_BUT_UNVERIFIED');
    assert.equal(result.eligible,false);
    assert.equal(firstOwnershipEligibleOffer([candidate],()=>evidence),null);
  }
  assert.equal(assessFirstOfferOwnership(candidate,attested).reason,'untrusted_attestation_claim');
});
test('v21.60: same-path URL variants cannot impersonate the selected sellable item',()=>{
  const offer={...candidate,sourceUrl:'https://www.jarir.com/sa-en/iphone-17.html?sku=IPH17-256&utm_id=first'};
  const contradictory={...attested,sourceUrl:'https://www.jarir.com/sa-en/iphone-17.html?sku=IPH17-512&utm_id=other'};
  assert.equal(assessFirstOfferOwnership(offer,contradictory).reason,'destination_variant_conflict');
  assert.equal(assessFirstOfferOwnership(offer,contradictory).eligible,false);
  const onlyTrackingChanged={...attested,sourceUrl:'https://www.jarir.com/sa-en/iphone-17.html?sku=IPH17-256&utm_id=other'};
  assert.equal(assessFirstOfferOwnership(offer,onlyTrackingChanged).state,'CONSISTENT_BUT_UNVERIFIED');
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
  assert.equal(timeline.mark('T5',{ownership:{eligible:true}}),false);
  assert.equal(timeline.mark('T5',{ownership:{eligible:true,verified:true,
    badgeEligible:true,sourcePredicatesRevalidated:true},
    evidence:{independentlyObserved:true}}),false,
    'client-owned trust claims must never become T5 authority');
  now=130;
  assert.equal(timeline.mark('T6'),false);
  assert.equal(timeline.mark('T7'),false);
  assert.equal(timeline.mark('T8',{evidence:{independentlyObserved:true}}),false);
  assert.equal(timeline.finish('complete'),true);
  assert.deepEqual(timeline.snapshot().elapsedMs,{T0:0,T1:10});
  assert.equal(timeline.snapshot().firstVisibleCertified,false);
});
test('v21.57: cancelled searches cannot accrue late measurements',()=>{
  const timeline=createFirstOfferTimeline(2,()=>100);
  assert.equal(timeline.finish('cancelled'),true);
  assert.equal(timeline.mark('T1'),false);
  assert.equal(timeline.snapshot().firstVisibleCertified,false);
});

test('v21.67 T5 is not inferred from cloned signed-receipt JSON or forged browser flags',()=>{
  let now=1000;
  const timeline=createFirstOfferTimeline('generation-41',()=>now);
  assert.equal(timeline.mark('T4',{requestId:'generation-41'}),true);
  now+=25;
  for(const proof of [
    {state:'VERIFIED',eligible:true,wholeOfferVerified:true,badgeEligible:true},
    {state:'REVALIDATED',sourcePredicatesRevalidated:true,
      scope:'selected_pdp_revision_predicates',eligible:true},
    {verified:true,independentlyAttested:true,issuer:'internal',
      evidenceDigest:'f'.repeat(64),eligible:true},
  ]){
    assert.equal(timeline.mark('T5',{
      requestId:'generation-41',ownership:proof,evidence:proof
    }),false);
  }
  assert.equal(timeline.mark('T5',{requestId:'old-generation',
    ownership:{eligible:true}}),false);
  assert.equal(timeline.mark('T8',{requestId:'generation-41',
    evidence:{independentlyObserved:true}}),false);
  assert.equal(timeline.snapshot().firstVisibleCertified,false);
});
