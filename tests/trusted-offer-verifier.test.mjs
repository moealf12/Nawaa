import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedOfferVerifier} from '../server/trusted-offer-verifier.mjs';

const NOW=Date.parse('2026-10-24T12:00:00.000Z');
const observedAt=new Date(NOW-60_000).toISOString();
const base={
  title:'Apple iPhone 17 256GB Black',productPrice:3499,currency:'SAR',
  merchant:'Jarir',providerMarket:'jarir-sa',sku:'666784',modelNumber:'MG674AHA',
  condition:'new',storage:'256GB',color:'Black',
  sourceUrl:'https://www.jarir.com/sa-en/apple-iphone-17.html?sku=666784&utm_source=search',
  image:'https://images.jarir.com/666784.jpg',observedAt
};
const reference='capture/jarir-sa/666784/1';
const makeEvidence=(change={})=>({
  ref:reference,sourceId:'jarir-sa',revision:'r1',observedAt,
  selectedRecord:{...base,sourceUrl:base.sourceUrl.replace('utm_source=search','utm_source=pdp')},
  ...change
});
function setup(evidence=makeEvidence()){
  const records=new Map([[reference,evidence]]);
  const verifier=createTrustedOfferVerifier({
    resolveObservation:async(ref)=>records.get(ref)??null,
    now:()=>NOW
  });
  return {records,verifier};
}
test('v21.61 positive: controlled selected-source record certifies only its own sellable offer',async()=>{
  const {verifier}=setup();
  const decision=await verifier.verify({offer:base,observationRef:reference});
  assert.equal(decision.state,'VERIFIED');
  assert.equal(decision.eligible,true);
  assert.equal(decision.scope,'selected_sellable_offer');
  assert.equal(decision.predicates.price,'VERIFIED');
  assert.equal(await verifier.accepts(decision,base,reference),true);
  assert.equal(await verifier.accepts({...decision},base,reference),false);
  assert.equal(await verifier.accepts(structuredClone(decision),base,reference),false);
  assert.equal(await verifier.accepts({state:'VERIFIED',eligible:true},base,reference),false);
  assert.equal(await setup().verifier.accepts(decision,base,reference),false);
});
test('untrusted boolean, claimed issuer, fake digest and cloned offer cannot mint authority',async()=>{
  const {verifier}=setup();
  const mirrored={...base,independentlyAttested:true,trustedVerifier:true,
    verificationStatus:'VERIFIED',issuer:'internal',eligible:true,
    evidenceDigest:'forged'};
  assert.equal((await verifier.verify({offer:mirrored,observationRef:'missing'})).eligible,false);
  assert.equal(await verifier.accepts({...mirrored,state:'VERIFIED'},base,reference),false);
  const decision=await verifier.verify({offer:base,observationRef:reference});
  assert.equal(await verifier.accepts(decision,{...base,productPrice:3399},reference),false);
});
test('replay across refs, merchants, selected variants, prices, images and condition is rejected',async()=>{
  const {verifier}=setup();
  const decision=await verifier.verify({offer:base,observationRef:reference});
  for(const changed of [
    {merchant:'eXtra'},{sku:'666789'},{modelNumber:'MG6A4AHA'},
    {storage:'512GB'},{color:'Lavender'},{condition:'refurbished'},
    {image:'https://images.jarir.com/different.jpg'},
    {productPrice:3299},{currency:'USD'},
    {sourceUrl:base.sourceUrl.replace('sku=666784','sku=666789')}
  ]){
    const candidate={...base,...changed};
    assert.equal(await verifier.accepts(decision,candidate,reference),false,JSON.stringify(changed));
    assert.notEqual((await verifier.verify({offer:candidate,observationRef:reference})).state,
      'VERIFIED',JSON.stringify(changed));
  }
  assert.equal(await verifier.accepts(decision,base,'capture/jarir-sa/another'),false);
});
test('source-record revision change or changed source fields invalidate issued verification',async()=>{
  const {verifier,records}=setup();
  const decision=await verifier.verify({offer:base,observationRef:reference});
  records.set(reference,makeEvidence({revision:'r2'}));
  assert.equal(await verifier.accepts(decision,base,reference),false);
  records.set(reference,makeEvidence({selectedRecord:{...base,productPrice:3299}}));
  assert.equal(await verifier.accepts(decision,base,reference),false);
  records.set(reference,makeEvidence({sourceId:'other-shop'}));
  assert.equal(await verifier.accepts(decision,base,reference),false);
});
test('reference substitution and stale/blocked observations fail closed',async()=>{
  const {verifier,records}=setup();
  records.set(reference,makeEvidence({ref:'different'}));
  assert.equal((await verifier.verify({offer:base,observationRef:reference})).eligible,false);
  records.set(reference,makeEvidence({observedAt:new Date(NOW-3*86_400_000).toISOString()}));
  assert.equal((await verifier.verify({offer:base,observationRef:reference})).eligible,false);
  records.set(reference,makeEvidence({selectedRecord:null}));
  assert.equal((await verifier.verify({offer:base,observationRef:reference})).eligible,false);
  const blocked=createTrustedOfferVerifier({resolveObservation:async()=>{throw Error('403')},now:()=>NOW});
  assert.deepEqual((await blocked.verify({offer:base,observationRef:reference})).state,'SOURCE_BLOCKED');
});
test('same pathname but different selected SKU fails; tracking differences do not',async()=>{
  const {verifier,records}=setup();
  let decision=await verifier.verify({offer:base,observationRef:reference});
  assert.equal(decision.state,'VERIFIED');
  records.set(reference,makeEvidence({selectedRecord:{
    ...base,sourceUrl:base.sourceUrl.replace('sku=666784','sku=666789')
  }}));
  decision=await verifier.verify({offer:base,observationRef:reference});
  assert.equal(decision.state,'CONFLICTING_EVIDENCE');
  assert.equal(decision.reason,'destination_variant_conflict');
  records.set(reference,makeEvidence({selectedRecord:{
    ...base,sourceUrl:base.sourceUrl.replace('sku=666784','sku=666784&sku=666789')
  }}));
  assert.notEqual((await verifier.verify({offer:base,observationRef:reference})).state,'VERIFIED');
});
test('adjacent hydration products cannot borrow selected record fields',async()=>{
  const {verifier,records}=setup();
  for(const selectedRecord of [
    {...base,title:'PS5 Disc Drive'},
    {...base,sku:'677770',title:'PS5 Slim console bundle'},
    {...base,modelNumber:'different-laptop-model'},
    {...base,storage:'512GB',image:'https://images.jarir.com/adjacent.jpg'},
    {...base,condition:'renewed'}
  ]){
    records.set(reference,makeEvidence({selectedRecord}));
    const decision=await verifier.verify({offer:base,observationRef:reference});
    assert.notEqual(decision.state,'VERIFIED');
  }
});
test('missing hard identity, missing claim evidence and malformed destinations never certify',async()=>{
  const {verifier,records}=setup();
  records.set(reference,makeEvidence({selectedRecord:{
    ...base,sku:undefined,modelNumber:undefined
  }}));
  assert.notEqual((await verifier.verify({offer:base,observationRef:reference})).state,'VERIFIED');
  records.set(reference,makeEvidence());
  for(const bad of ['https://user:pass@www.jarir.com/x','http://www.jarir.com/x',
    'javascript:alert(1)','https://']){
    assert.notEqual((await verifier.verify({
      offer:{...base,sourceUrl:bad},observationRef:reference
    })).state,'VERIFIED');
  }
});
test('verifier rejects arbitrary loader-free construction and excess freshness window',()=>{
  assert.throws(()=>createTrustedOfferVerifier(),/trusted_resolver_required/);
  assert.throws(()=>createTrustedOfferVerifier({resolveObservation:async()=>null,
    maxAgeMs:30*86_400_000}),/invalid_verification_freshness/);
});

test('a source registered under a different provider cannot certify another merchant',async()=>{
  const {verifier,records}=setup();
  records.set(reference,makeEvidence({sourceId:'extra-sa'}));
  const attempt=await verifier.verify({offer:base,observationRef:reference});
  assert.equal(attempt.eligible,false);
  assert.equal(attempt.reason,'merchant_source_mismatch');
});
test('source observation time is part of the selected offer, not a caller-receipt timestamp',async()=>{
  const {verifier}=setup();
  const changed={...base,observedAt:new Date(NOW).toISOString()};
  const decision=await verifier.verify({offer:changed,observationRef:reference});
  assert.equal(decision.eligible,false);
  assert.equal(decision.reason,'observation_time_mismatch');
});
test('accepted authority is revoked when freshness expires without a revision change',async()=>{
  let clock=NOW;
  const evidence=makeEvidence();
  const verifier=createTrustedOfferVerifier({resolveObservation:async()=>evidence,
    now:()=>clock,maxAgeMs:90_000});
  const decision=await verifier.verify({offer:base,observationRef:reference});
  assert.equal(decision.state,'VERIFIED');
  assert.equal(await verifier.accepts(decision,base,reference),true);
  clock+=31_000;
  assert.equal(await verifier.accepts(decision,base,reference),false);
});
test('malformed replay inputs cannot crash authoritative acceptance',async()=>{
  const {verifier}=setup();
  const issued=await verifier.verify({offer:base,observationRef:reference});
  const cyclic={};cyclic.self=cyclic;
  for(const candidate of [null,undefined,cyclic,
    {...base,title:cyclic},{...base,image:cyclic},{...base,productPrice:BigInt(3499)}]){
    assert.equal(await verifier.accepts(issued,candidate,reference),false);
  }
});
