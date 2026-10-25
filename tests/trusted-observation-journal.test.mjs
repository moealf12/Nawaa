import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';

const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
const CLOCK=Date.parse('2026-10-24T14:00:00.000Z');
const RECORD='a'.repeat(64),DOCUMENT='b'.repeat(64);
const owned=Object.fromEntries(['name','offers','image','sku','mpn','brand','color','condition','availability'].map(k=>
  [k,{strategy:'jsonld',recordId:RECORD}]));
const observedAt=new Date(CLOCK-1000).toISOString();
const page=()=>({
  provider:'url-resolver',providerMarket:'www.jarir.com',dataKind:'live',merchant:'Jarir',
  resolvedPageUrl:URL,sourceUrl:URL,observedAt,title:'Sony PS5 Slim Disc Console',
  productPrice:2529,originalProductPrice:2529,currency:'SAR',originalCurrency:'SAR',
  sku:'668751',gtin:null,image:'https://static.jarir.com/668751.jpg',
  condition:'new',availability:'in_stock',
  specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White'},
  extraction:{
    selectedProductRecord:{recordId:RECORD,documentDigest:DOCUMENT,source:'jsonld_product_offer',
      selectedProductUrl:URL,selectedOfferUrl:URL,selectedCount:1,productCount:1},
    reconciled:false,availableStrategies:['jsonld'],
    identity:{summary:{accepted:1,rejected:0}},conflictSummary:{hasConflicts:false},
    fieldSources:owned
  }
});
const offer=()=>({
  providerMarket:'jarir-sa',merchant:'Jarir',sourceUrl:URL,
  title:'Indexed PS5 alias',productPrice:2499,currency:'SAR',sku:'668751',
  image:'https://static.jarir.com/old.jpg',condition:'new',availability:'in_stock',
  specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White',barcode:'OLD-UNSUPPORTED'},
  independentlyAttested:true,eligible:true,verified:true
});
const signingKey='test-only-zero-production-use-journal-HMAC-key-64bytes-long';
function store(){
  const rows=[];
  return {rows,append:async e=>{rows.push(structuredClone(e))},
    events:async ref=>rows.filter(e=>e.ref===ref).map(e=>structuredClone(e))};
}
function journal(storage,key=signingKey,time=()=>CLOCK){
  return createTrustedObservationJournal({store:storage,signingKey:key,now:time});
}
async function issue(time=()=>CLOCK){
  const session=createPdpObservationSession({readSelectedPage:async()=>page(),now:time});
  const result=await session.verifySelectedRevision(offer());
  assert.equal(result.state,'VERIFIED',result.reason);
  assert.equal(result.badgeEligible,false);
  return {session,result};
}
test('v21.65 positive cross-instance signed receipt revalidates scoped predicates only',async()=>{
  const st=store(),first=journal(st),second=journal(st);
  const {result}=await issue();
  const archived=await first.archive(result);
  assert.equal(archived.state,'ARCHIVED');
  const verified=await second.inspect(archived.receiptRef,{expectedOffer:result.offer});
  assert.equal(verified.state,'REVALIDATED',verified.reason);
  assert.equal(verified.eligible,false,'revalidated audit receipt is not a customer badge');
  assert.equal(verified.sourcePredicatesRevalidated,true);
  assert.equal(verified.wholeOfferVerified,false);
  assert.equal(verified.badgeEligible,false);
  assert.equal(verified.predicates.gtin,'NOT_CLAIMED');
  assert.equal(verified.predicates.sku,'VERIFIED');
  assert.equal(verified.sourceRecord.recordId,RECORD);
  assert.equal(verified.sourceRecord.documentDigest,DOCUMENT);
  assert.equal(st.rows.length,1);
  assert.ok(!JSON.stringify(st.rows).includes(signingKey),'secret never stored with proof');
  assert.ok(!JSON.stringify(st.rows).includes('OLD-UNSUPPORTED'),
    'historical barcode not laundered into source-owned receipt');
});
test('v21.65 cloned, fabricated or duck-typed authorizers never archive',async()=>{
  const st=store(),j=journal(st);
  const {result}=await issue();
  const copy=structuredClone(result);
  assert.equal((await j.archive(copy)).state,'MISSING_EVIDENCE');
  assert.equal((await j.archive({...result})).state,'MISSING_EVIDENCE');
  assert.equal((await j.archive({session:{accepts:async()=>true},
    ...result,decision:{...result.decision}})).state,'MISSING_EVIDENCE');
  assert.equal(st.rows.length,0);
});
test('v21.65 signed record tampering and wrong server signing key reject across processes',async()=>{
  const st=store(),first=journal(st);
  const {result}=await issue();
  const {receiptRef}=await first.archive(result);
  assert.equal((await journal(st,'a-different-private-key-that-is-very-long').inspect(receiptRef)).state,
    'CONFLICTING_EVIDENCE');
  st.rows[0].payload=st.rows[0].payload.replace('2529','199');
  assert.equal((await first.inspect(receiptRef)).reason,'journal_integrity_failure');
});
test('v21.65 expiry prevents stale observation from becoming a fresh certificate',async()=>{
  const st=store(),j=journal(st);
  const {result}=await issue();
  const {receiptRef}=await j.archive(result);
  const after=journal(st,signingKey,()=>CLOCK+300_001);
  const verdict=await after.inspect(receiptRef);
  assert.equal(verdict.state,'EXPIRED');
  assert.equal(verdict.badgeEligible,false);
});
test('v21.65 signed tombstone revokes across processes and cannot be bypassed via copied receipts',async()=>{
  const st=store(),writer=journal(st),reader=journal(st);
  const {result}=await issue();
  const {receiptRef}=await writer.archive(result);
  assert.equal((await reader.inspect(receiptRef)).state,'REVALIDATED');
  assert.equal((await writer.revoke(receiptRef,'source_updated')).state,'REVOKED');
  assert.equal((await reader.inspect(receiptRef)).state,'REVOKED');
  assert.equal((await reader.inspect(receiptRef,{expectedOffer:result.offer})).state,'REVOKED');
  assert.equal(st.rows.length,2);
});
test('v21.65 reject source revisions, counterfeit predicate scope and duplicate captures',async()=>{
  const st=store(),j=journal(st);
  const {result}=await issue();
  const {receiptRef}=await j.archive(result);
  assert.equal((await j.inspect(receiptRef,{expectedOffer:{...result.offer,productPrice:1}})).reason,
    'offer_revision_mismatch');
  st.rows.push(structuredClone(st.rows[0]));
  assert.equal((await j.inspect(receiptRef)).state,'CONFLICTING_EVIDENCE');
  st.rows.pop();
  const third=structuredClone(st.rows[0]);third.payload=third.payload.replace(
    '"badgeEligible":false','"badgeEligible":true');
  st.rows[0]=third;
  assert.equal((await j.inspect(receiptRef)).state,'CONFLICTING_EVIDENCE');
});
test('v21.65 invalid storage, secret and external fabricated ref fail closed',async()=>{
  assert.throws(()=>createTrustedObservationJournal({store:store(),signingKey:'short'}),/strong_private/);
  assert.throws(()=>createTrustedObservationJournal({signingKey,store:{}}),/server_controlled/);
  const j=journal(store());
  assert.equal((await j.inspect('jarir-pdp:fake')).state,'MISSING_EVIDENCE');
  assert.equal((await j.archive({state:'VERIFIED'})).state,'MISSING_EVIDENCE');
  assert.equal((await j.revoke('pdp-audit:bogus','random')).state,'MISSING_EVIDENCE');
});
