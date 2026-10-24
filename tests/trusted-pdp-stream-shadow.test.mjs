import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdpStreamShadow,configuredPdpStreamShadow,createTransientPdpSourceHeadStore} from '../server/trusted-pdp-stream-shadow.mjs';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';
const now=Date.parse('2026-10-24T17:00:00Z');
const url='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
const record='a'.repeat(64);
const gen='12345678-1234-4abc-8123-123456789abc';
const candidate={merchant:'Jarir',providerMarket:'jarir-sa',sku:'668751',
  sourceUrl:url,condition:'new'};
const page={provider:'url-resolver',dataKind:'live',merchant:'Jarir',sourceUrl:url,
  resolvedPageUrl:url,observedAt:new Date(now-1000).toISOString(),
  title:'PS5 Slim Digital 825GB',productPrice:2529,originalProductPrice:2529,
  currency:'SAR',originalCurrency:'SAR',sku:'668751',condition:'new',
  image:'https://static.jarir.com/668751.jpg',
  extraction:{selectedProductRecord:{recordId:record,documentDigest:'b'.repeat(64),
    source:'jsonld_product_offer',selectedProductUrl:url,selectedOfferUrl:url,
    selectedCount:1},reconciled:false,availableStrategies:['jsonld'],
    conflictSummary:{hasConflicts:false},identity:{summary:{accepted:1,rejected:0}},
    fieldSources:Object.fromEntries(['offers','name','sku','image'].map(k=>[k,{
      strategy:'jsonld',recordId:record}]))}};
function fakeStore(){
  const rows=[],heads=new Map();
  const store={
    append:async e=>rows.push(e),
    events:async ref=>rows.filter(x=>x.ref===ref),
    currentHead:async key=>heads.get(key)||null,
    appendCapture:async(e,b)=>{heads.set(b.sourceKey,{...b});rows.push(e);return true;},
    advanceHead:async b=>{heads.set(b.sourceKey,{...b});return true;}
  };
  return {store,heads};
}
function fixture(){
  const {store,heads}=fakeStore();
  const journal=createTrustedObservationJournal({store,
    signingKey:'v21-71-internal-shadow-only-test-private-key-never-production',
    requireCurrentHead:true,now:()=>now+2000});
  const createSession=()=>createPdpObservationSession({
    readSelectedPage:async()=>page,now:()=>now+2000});
  const events=[];
  const shadow=createPdpStreamShadow({
    journal,createSession,streamGeneration:gen,
    sendEvent:(name,details)=>events.push({name,details})});
  return {journal,createSession,events,shadow,heads};
}
test('v21.71 no source proof is manufactured by an ordinary search snapshot',async()=>{
  const h=fixture();
  const ordinary={offers:[{title:'HP laptop',merchant:'eXtra',providerMarket:'extra-sa',
    productPrice:1999,sourceUrl:'https://example.org/laptop'}]};
  h.shadow.consider(ordinary,1);
  await h.shadow.whenSettled();
  assert.equal(h.shadow.started,false);
  assert.equal(h.events.length,0);
  h.shadow.close();
  assert.equal(configuredPdpStreamShadow({env:{NAWAA_TRUST_PDP_SSE_SHADOW:'1'},
    streamGeneration:gen,sendEvent:()=>{}}),null,
    'no private signing keys must produce no source traffic');
});
test('v21.71 source changed while shadow read is pending cannot attest stale SSE frame',async()=>{
  const h=fixture();
  let unlock;
  const blocked=new Promise(resolve=>{unlock=resolve;});
  const slow=createPdpStreamShadow({journal:h.journal,streamGeneration:gen,
    createSession:()=>createPdpObservationSession({
      readSelectedPage:async()=>{await blocked;return page},now:()=>now+2000}),
    sendEvent:(name,details)=>h.events.push({name,details})});
  slow.consider({offers:[candidate]},1);
  assert.equal(slow.started,true);
  slow.consider({offers:[{...candidate,productPrice:1}]},2);
  unlock();
  await slow.whenSettled();
  assert.equal(h.events.length,0);
  slow.close();
});
test('v21.71 same-frame shadow positive is scoped to source predicates and never a badge',async()=>{
  const h=fixture();
  const selected=await h.createSession().verifySelectedRevision(candidate);
  assert.equal(selected.state,'VERIFIED',selected.reason);
  const exact=selected.offer;
  h.shadow.consider({offers:[exact]},1);
  await h.shadow.whenSettled();
  assert.equal(h.events.length,1,JSON.stringify(h.events));
  assert.equal(h.events[0].name,'source-predicate');
  const event=h.events[0].details;
  assert.equal(event.policy,'pdp-predicate-shadow-v1');
  assert.equal(event.scope,'selected_pdp_revision_predicates');
  assert.equal(event.sourceRecordId,record);
  assert.equal(event.snapshotRevision,1);
  for(const key of ['badgeEligible','customerVerified','wholeOfferVerified',
    't5Eligible','paintCertified','durableProof'])assert.equal(event[key],false,key);
  h.shadow.close();
});

test('v21.75 passive shadow never upgrades later conflicting source to authority',async()=>{
  const store=createTransientPdpSourceHeadStore();
  const first={sourceKey:'a'.repeat(64),revision:'b'.repeat(64),
    recordId:'c'.repeat(64),observedAt:new Date(now-2000).toISOString()};
  assert.equal(await store.advanceHead(first),true);
  const second={...first,revision:'d'.repeat(64),recordId:'e'.repeat(64),
    observedAt:new Date(now+2000).toISOString()};
  assert.equal(await store.advanceHead(second),false);
  assert.equal((await store.currentHead(first.sourceKey)).conflicted,true);
  assert.equal(await store.advanceHead(first),false,
    'stale source replay cannot clear a known conflict');
});
