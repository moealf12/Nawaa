import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedPdpStreamBridge} from '../server/trusted-pdp-stream-bridge.mjs';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';

const NOW=Date.parse('2026-10-24T17:30:00Z');
const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
const UUID='12345678-1234-4abc-8123-123456789abc';
const DIGEST='a'.repeat(64);
const candidate=()=>({providerMarket:'jarir-sa',merchant:'Jarir',sourceUrl:URL,
  sku:'668751',specs:{modelNumber:'CFI2116B01Y',brand:'Sony'},condition:'new'});
function page(price=2529){
  return {provider:'url-resolver',dataKind:'live',merchant:'Jarir',
    sourceUrl:URL,resolvedPageUrl:URL,observedAt:new Date(NOW-1_000).toISOString(),
    title:'PS5 Slim Digital 825 GB',productPrice:price,originalProductPrice:price,
    currency:'SAR',originalCurrency:'SAR',sku:'668751',
    image:'https://static.jarir.com/668751.jpg',condition:'new',
    availability:'in_stock',specs:{brand:'Sony',modelNumber:'CFI2116B01Y'},
    extraction:{selectedProductRecord:{source:'jsonld_product_offer',
      recordId:DIGEST,documentDigest:'b'.repeat(64),
      selectedProductUrl:URL,selectedOfferUrl:URL,selectedCount:1},
      reconciled:false,availableStrategies:['jsonld'],
      identity:{summary:{accepted:1,rejected:0}},
      conflictSummary:{hasConflicts:false},
      fieldSources:Object.fromEntries(['offers','name','sku','mpn','image','brand','condition','availability']
        .map(key=>[key,{strategy:'jsonld',recordId:DIGEST}]))}
  };
}
function makeStore(){
  const rows=[],heads=new Map();
  const update=x=>{
    const current=heads.get(x.sourceKey);
    if(current&&Date.parse(x.observedAt)<Date.parse(current.observedAt))return false;
    heads.set(x.sourceKey,{...x});return true;
  };
  return {rows,heads,
    append:async x=>rows.push(x),
    events:async ref=>rows.filter(x=>x.ref===ref),
    currentHead:async key=>heads.get(key)||null,
    appendCapture:async(x,head)=>{if(!update(head))return false;rows.push(x);return true;},
    advanceHead:async x=>update(x)};
}
function setup(){
  const store=makeStore();
  const journal=createTrustedObservationJournal({store,
    signingKey:'isolated-v21-70-test-key-never-a-real-signing-secret',
    now:()=>NOW+2000,requireCurrentHead:true});
  const createSession=()=>createPdpObservationSession({
    now:()=>NOW+2000,readSelectedPage:async()=>page()});
  const bridge=createTrustedPdpStreamBridge({journal,createSession,
    streamGeneration:UUID});
  return {store,journal,bridge};
}
async function ready(){
  const h=setup();
  const prepared=await h.bridge.observe(candidate());
  assert.equal(prepared.state,'STAGED_SOURCE_PREDICATES',JSON.stringify(prepared));
  assert.equal(h.bridge.beginRender(1),true);
  // Source-issued selected revision is the outbound candidate. The journal's
  // intentionally smaller predicate-only snapshot is NOT interchangeable.
  const offer=prepared.selectedOffer;
  const capture=h.store.rows.find(e=>e.kind==='capture');
  assert.ok(capture);
  const verified=(await h.journal.inspect(capture.ref));
  assert.equal(verified.state,'REVALIDATED');
  return {...h,prepared,offer,captureRef:capture.ref};
}
const binding=(offer,rev=1,epoch=1,uuid=UUID)=>({
  streamGeneration:uuid,snapshotRevision:rev,renderEpoch:epoch,
  offers:[offer],offerIndex:0});
test('v21.70 positive original-issued selected-PDP predicate record binds only its unique outbound snapshot offer',async()=>{
  const h=await ready();
  const bound=await h.bridge.bind(h.prepared,binding(h.offer));
  assert.equal(bound.state,'SOURCE_PREDICATES_BOUND',JSON.stringify(bound));
  assert.equal(bound.sourceRevision,h.prepared.sourceRevision);
  assert.equal(bound.sourceRecordId,DIGEST);
  assert.equal(bound.scope,'selected_pdp_revision_predicates');
  assert.equal(bound.sourcePredicatesRevalidated,true);
  assert.equal(bound.wholeOfferVerified,false);
  assert.equal(bound.badgeEligible,false);
  assert.equal(bound.t5Eligible,false);
});
test('mutated price, title, image, SKU, variant, merchant and extra unverified content cannot borrow a PDP receipt',async()=>{
  for(const field of [
    {productPrice:1999},{title:'disc drive only'},{sku:'668752'},
    {image:'https://static.jarir.com/adjacent.jpg'},{currency:'USD'},
    {merchant:'eXtra'}, {specs:{brand:'Sony',modelNumber:'different'}},
    {unverifiedVerifiedBadge:true},{variant:{storage:'1TB'}}
  ]){
    const h=await ready();
    const denial=await h.bridge.bind(h.prepared,binding({...h.offer,...field}));
    assert.equal(denial.state,'DENIED',JSON.stringify(field));
    assert.equal(denial.badgeEligible,false);
  }
});
test('duplicate source-owned records, mismatched generation, spoofed object and revoked receipts fail closed',async()=>{
  const h=await ready();
  assert.equal((await h.bridge.bind(h.prepared,{...binding(h.offer),
    offers:[h.offer,{...h.offer}]})).state,'DENIED');
  assert.equal((await h.bridge.bind({...h.prepared},binding(h.offer))).state,'DENIED');
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer,1,1,
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'))).state,'DENIED');
  assert.equal((await h.journal.revoke(h.captureRef,'fixture_source_revoked')).state,
    'MISSING_EVIDENCE','invalid revocation reasons must not mutate journal state');
  assert.equal((await h.journal.revoke(h.captureRef,'security_revoke')).state,'REVOKED');
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer))).state,'DENIED');
});
test('source-head supersession and revocation of the bridge invalidate old source predicate evidence',async()=>{
  const h=await ready();
  const oldHead=[...h.store.heads.entries()][0];
  h.store.heads.set(oldHead[0],{...oldHead[1],revision:'f'.repeat(64)});
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer))).state,'DENIED');
  const next=await ready();
  next.bridge.revoke();
  assert.equal((await next.bridge.bind(next.prepared,binding(next.offer))).state,'DENIED');
});
test('stream snapshot revision is single-use and replay cannot mint source ownership',async()=>{
  const h=await ready();
  const first=await h.bridge.bind(h.prepared,binding(h.offer));
  assert.equal(first.state,'SOURCE_PREDICATES_BOUND');
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer))).state,'DENIED');
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer,0))).state,'DENIED');
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer,2))).state,
    'SOURCE_PREDICATES_BOUND');
  assert.equal(h.bridge.beginRender(2),true);
  assert.equal(h.bridge.beginRender(1),false);
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer,3,1))).state,
    'DENIED','an old DOM epoch cannot become valid again');
  assert.equal((await h.bridge.bind(h.prepared,binding(h.offer,3,2))).state,
    'SOURCE_PREDICATES_BOUND');
});
