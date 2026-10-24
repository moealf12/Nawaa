import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedOfferVerifier} from '../server/trusted-offer-verifier.mjs';
import {createTrustedDisplayOwnership} from '../server/trusted-display-ownership.mjs';

const now=Date.parse('2026-10-24T12:00:00.000Z');
const observedAt=new Date(now-10_000).toISOString();
const generation='12345678-1234-4abc-8123-123456789abc';
const other='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ref='pdp/selected/668751';
const offer={title:'Jarir Apple iPhone 17 256GB',productPrice:3499,currency:'SAR',
  merchant:'Jarir',providerMarket:'jarir-sa',sku:'668751',storage:'256GB',
  color:'Black',condition:'new',observedAt,
  sourceUrl:'https://www.jarir.com/iphone-17.html?sku=668751',
  image:'https://www.jarir.com/assets/iphone.jpg'};
function harness(){
  const observations=new Map([[ref,{ref,sourceId:'jarir-sa',revision:'r1',
    observedAt,selectedRecord:{...offer}}]]);
  const verifier=createTrustedOfferVerifier({
    resolveObservation:async key=>observations.get(key)||null,now:()=>now});
  const display=createTrustedDisplayOwnership({verifier,streamGeneration:generation});
  return {observations,verifier,display};
}
async function valid(){
  const h=harness();
  const decision=await h.verifier.verify({offer,observationRef:ref});
  assert.equal(decision.state,'VERIFIED');
  assert.equal(h.display.advance(1,[offer]),true);
  assert.equal(h.display.beginRender(1),true);
  const bound=await h.display.bind({decision,offer,observationRef:ref,displayOffer:{...offer},
    streamGeneration:generation,snapshotRevision:1,renderEpoch:1});
  assert.equal(bound.state,'BOUND_INTERNAL');
  return {...h,decision,bound};
}
const context=(e=offer,gen=generation,rev=1,epoch=1)=>({
  displayOffer:e,streamGeneration:gen,snapshotRevision:rev,renderEpoch:epoch
});

test('v21.69 server binds only an original controlled whole-offer decision to exact displayed content',async()=>{
  const h=await valid();
  assert.equal(await h.display.accepts(h.bound,context()),true);
  assert.equal(h.bound.badgeEligible,false);
  assert.equal(h.bound.customerVerified,false);
  assert.equal(h.bound.t5Eligible,false);
  assert.equal(await h.display.accepts({...h.bound},context()),false);
  assert.equal(await h.display.accepts(structuredClone(h.bound),context()),false);
  assert.equal(await harness().display.accepts(h.bound,context()),false);
});
test('price, title, source, identifier, image, condition and variant mutations invalidate ownership',async()=>{
  const h=await valid();
  for(const mutation of [
    {productPrice:3498},{title:'different product'},{sku:'668752'},
    {storage:'512GB'},{color:'Lavender'},{condition:'refurbished'},
    {image:'https://www.jarir.com/assets/another.jpg'},
    {sourceUrl:'https://www.jarir.com/iphone-17.html?sku=668752'},
    {merchant:'eXtra'}, {currency:'USD'}, {providerMarket:'extra-sa'},
    {specs:{storage:'512GB'}},{sourceMeta:{nameAr:'neighbor'}}
  ]){
    assert.equal(await h.display.accepts(h.bound,context({...offer,...mutation})),false,
      JSON.stringify(mutation));
    const denied=await h.display.bind({decision:h.decision,offer,
      observationRef:ref,displayOffer:{...offer,...mutation},
      streamGeneration:generation,snapshotRevision:1,renderEpoch:1});
    assert.equal(denied.badgeEligible,false);
    assert.equal(denied.state,'DENIED',JSON.stringify(mutation));
  }
});
test('new search generation, snapshot, render or ref invalidates old binding',async()=>{
  const h=await valid();
  assert.equal(await h.display.accepts(h.bound,context(offer,other)),false);
  assert.equal(await h.display.accepts(h.bound,context(offer,generation,2)),false);
  assert.equal(await h.display.accepts(h.bound,context(offer,generation,1,2)),false);
  assert.equal(h.display.beginRender(2),true);
  assert.equal(await h.display.accepts(h.bound,context()),false,
    'stale render epoch must revoke old internal ownership');
  assert.equal(h.display.beginRender(1),false);
  assert.equal(h.display.advance(1,[offer]),false);
  assert.equal(h.display.advance(0,[offer]),false);
  assert.equal(h.display.advance(2,[]),true);
  assert.equal(await h.display.accepts(h.bound,context()),false);
  assert.equal(await h.display.bind({decision:h.decision,offer,displayOffer:offer,
    observationRef:ref,streamGeneration:generation,snapshotRevision:2,renderEpoch:1}).then(x=>x.state),'DENIED');
  h.display.revoke();
  assert.equal(h.display.advance(3,[offer]),false);
  assert.equal(await h.display.accepts(h.bound,context()),false);
});
test('source revision changes, expiration or revocation invalidate bound result',async()=>{
  const h=await valid();
  h.observations.set(ref,{ref,sourceId:'jarir-sa',revision:'r2',observedAt,
    selectedRecord:{...offer}});
  assert.equal(await h.display.accepts(h.bound,context()),false);
  h.observations.delete(ref);
  assert.equal(await h.display.accepts(h.bound,context()),false);
});
test('caller-created VERIFIED flags, fake decisions and lookalike display data never bind',async()=>{
  const h=await valid();
  for(const decision of [
    {...h.decision},structuredClone(h.decision),
    {state:'VERIFIED',eligible:true,scope:'selected_sellable_offer',
      evidenceRevision:'r1',observationRef:ref},
    {state:'VERIFIED',eligible:true,scope:'selected_pdp_revision_predicates',
      evidenceRevision:'r1',observationRef:ref}
  ]){
    const denied=await h.display.bind({decision,offer,observationRef:ref,
      displayOffer:offer,streamGeneration:generation,snapshotRevision:1,renderEpoch:1});
    assert.equal(denied.state,'DENIED');
  }
  for(const invalid of [null,[],{},'abc',{...offer,title:()=> 'fake'}]){
    assert.equal(await h.display.accepts(h.bound,context(invalid)),false);
  }
});
test('malformed and boundary inputs fail closed without modifying prior valid snapshot',async()=>{
  const h=await valid();
  const cyclic={...offer};cyclic.self=cyclic;
  for(const malformed of [cyclic,{...offer,productPrice:NaN},
    {...offer,image:'x'.repeat(100000)},
    {...offer,sku:BigInt(1)},
    {...offer,specs:{get sku(){throw Error('getter')}}}]){
    assert.equal(h.display.advance(2,[malformed]),false);
    assert.equal(await h.display.accepts(h.bound,context(malformed)),false);
  }
  assert.equal(h.display.currentSnapshotRevision,2);
  assert.equal(await h.display.accepts(h.bound,context()),false,
    'malformed newer snapshots must invalidate earlier ownership');
  assert.equal(h.display.advance(3,new Array(501).fill(offer)),false);
  assert.equal(h.display.currentSnapshotRevision,3);
  assert.throws(()=>createTrustedDisplayOwnership(),/required/);
});

test('v21.69 unverified merchant enrichment is not converted into display authority',async()=>{
  const h=await valid();
  for(const extra of [
    {merchantRating:5}, {shippingPromise:'delivers today'}, {verified:true},
    {sourceMeta:{nameAr:'unverified adjacent title'}},
    {specs:{battery:'unverified battery'}},
    {variant:{carrierPlan:'locked'}}
  ]){
    const enriched={...offer,...extra};
    assert.equal((await h.display.bind({
      decision:h.decision,offer:enriched,displayOffer:enriched,
      observationRef:ref,streamGeneration:generation,
      snapshotRevision:1,renderEpoch:1})).state,'DENIED');
    assert.equal(await h.display.accepts(h.bound,context(enriched)),false);
  }
});

test('v21.69 shadow identity and variant conflicts are never promoted from covered primary fields',async()=>{
  const h=await valid();
  for(const extra of [
    {sourceMeta:{productId:'668752'}},
    {specs:{modelNumber:'different'},modelNumber:'MG674AHA'},
    {brand:'Apple',specs:{brand:'Samsung'}},
    {storage:'256GB',variant:{storage:'512GB'}},
    {color:'Black',specs:{color:'Lavender'}},
    {condition:'new',variant:{condition:'refurbished'}}
  ]){
    const enriched={...offer,...extra};
    assert.equal((await h.display.bind({decision:h.decision,offer:enriched,
      displayOffer:enriched,observationRef:ref,streamGeneration:generation,
      snapshotRevision:1,renderEpoch:1})).state,'DENIED',JSON.stringify(extra));
  }
});

test('v21.69 duplicate identical records do not invent unique display ownership',async()=>{
  const h=await valid();
  assert.equal(h.display.advance(2,[offer,{...offer}]),false);
  assert.equal(h.display.currentSnapshotRevision,2);
  assert.equal(await h.display.accepts(h.bound,context()),false);
  assert.equal(h.display.advance(3,[offer]),true);
  assert.equal(h.display.beginRender(2),true);
  const rebound=await h.display.bind({decision:h.decision,offer,displayOffer:offer,
    observationRef:ref,streamGeneration:generation,snapshotRevision:3,renderEpoch:2});
  assert.equal(rebound.state,'BOUND_INTERNAL');
  assert.equal(rebound.badgeEligible,false);
});
test('v21.69 asynchronous verification cannot mint bindings after snapshot or render supersession',async()=>{
  const records=new Map([[ref,{ref,sourceId:'jarir-sa',revision:'r1',
    observedAt,selectedRecord:{...offer}}]]);
  let unblock=null;
  let entered=null;
  const gated=new Promise(resolve=>{entered=resolve;});
  const waitForRelease=new Promise(resolve=>{unblock=resolve;});
  let gatedRead=false;
  const verifier=createTrustedOfferVerifier({
    now:()=>now,
    resolveObservation:async key=>{
      if(gatedRead){entered();await waitForRelease;}
      return records.get(key)||null;
    }
  });
  const display=createTrustedDisplayOwnership({verifier,streamGeneration:generation});
  const decision=await verifier.verify({offer,observationRef:ref});
  assert.equal(display.advance(1,[offer]),true);
  assert.equal(display.beginRender(1),true);
  gatedRead=true;
  const pending=display.bind({decision,offer,displayOffer:offer,observationRef:ref,
    streamGeneration:generation,snapshotRevision:1,renderEpoch:1});
  await gated;
  assert.equal(display.advance(2,[offer]),true);
  assert.equal(display.beginRender(2),true);
  unblock();
  assert.equal((await pending).state,'DENIED');
});
test('v21.69 asynchronous accepts fails closed when epoch changes during source read',async()=>{
  const h=await valid();
  let started=null,release=null;
  let gate=false;
  const entered=new Promise(resolve=>{started=resolve;});
  const unblock=new Promise(resolve=>{release=resolve;});
  const verifier={
    accepts:async()=>{if(gate){started();await unblock;}return true;}
  };
  const guard=createTrustedDisplayOwnership({verifier,streamGeneration:generation});
  assert.equal(guard.advance(1,[offer]),true);
  assert.equal(guard.beginRender(1),true);
  // This isolated concurrency test uses a controlled verifier stub. It cannot
  // prove source attestation; it proves read-side epoch invalidation behavior.
  const fakeDecision={state:'VERIFIED',eligible:true,scope:'selected_sellable_offer',
    evidenceRevision:'r1',observationRef:ref};
  const bound=await guard.bind({decision:fakeDecision,offer,displayOffer:offer,
    observationRef:ref,streamGeneration:generation,snapshotRevision:1,renderEpoch:1});
  assert.equal(bound.state,'BOUND_INTERNAL');
  gate=true;
  const pending=guard.accepts(bound,context());
  await entered;
  assert.equal(guard.beginRender(2),true);
  release();
  assert.equal(await pending,false);
  assert.equal(await h.display.accepts(h.bound,context()),true,
    'independent original verifier remains unaffected');
});

test('v21.69 conflicting bundle membership aliases cannot borrow same-offer trust',async()=>{
  const h=await valid();
  for(const attrs of [
    {bundleContents:['console'],variant:{bundleContents:['disc drive']}},
    {bundleContents:['console'],variant:{bundleContents:['console','controller']}},
    {bundleContents:['console'],variant:{bundleContents:[123]}},
    {bundleContents:'console',variant:{bundleContents:['console']}},
    {bundleContents:['console'],variant:{bundleContents:'console'}}
  ]){
    const disputed={...offer,...attrs};
    const bound=await h.display.bind({
      decision:h.decision,offer:disputed,displayOffer:disputed,
      observationRef:ref,streamGeneration:generation,snapshotRevision:1,renderEpoch:1
    });
    assert.equal(bound.state,'DENIED',JSON.stringify(attrs));
  }
});

test('v21.75 occurrence: conflicting snapshot replay with same revision invalidates old internal authority',async()=>{
  const h=await valid();
  assert.equal(await h.display.accepts(h.bound,context()),true);
  assert.equal(h.display.advance(1,[{...offer,productPrice:3498}]),false);
  assert.equal(await h.display.accepts(h.bound,context()),false);
  assert.equal(h.display.advance(1,[offer]),false,
    'replaying old content cannot resurrect a previously conflicted frame');
  assert.equal(await h.display.accepts(h.bound,context()),false);
  assert.equal(h.bound.badgeEligible,false);
});
test('v21.75 occurrence: exact idempotent snapshot replay does not falsely revoke correct ownership',async()=>{
  const h=await valid();
  assert.equal(h.display.advance(1,[{...offer}]),false);
  assert.equal(await h.display.accepts(h.bound,context()),true);
  h.display.revoke();
  assert.equal(await h.display.accepts(h.bound,context()),false);
});
