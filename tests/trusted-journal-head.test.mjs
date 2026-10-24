import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';
import {createTrustedJournalKeyring,trustedJournalKeyringFromEnv} from '../server/trusted-journal-keyring.mjs';

const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
const CLOCK=Date.parse('2026-10-24T16:00:00.000Z');
const K1='private-signing-key-one-for-disposable-ci-not-production-64';
const K2='private-signing-key-two-for-disposable-ci-not-production-64';
const ring=(activeKeyId='k1',keys={k1:K1,k2:K2})=>
  createTrustedJournalKeyring({activeKeyId,keys});
function memory(){
  const rows=[],heads=new Map();
  const bind=b=>{
    const previous=heads.get(b.sourceKey);
    if(previous){
      if(Date.parse(b.observedAt)<Date.parse(previous.observedAt))return false;
      if(Date.parse(b.observedAt)===Date.parse(previous.observedAt)){
        if(previous.revision===b.revision&&previous.recordId===b.recordId&&!previous.conflicted)
          return true;
        heads.set(b.sourceKey,{...previous,conflicted:true});
        return false;
      }
    }
    heads.set(b.sourceKey,{...b,conflicted:false});return true;
  };
  return {rows,heads,append:async e=>{rows.push(structuredClone(e))},
    events:async ref=>rows.filter(x=>x.ref===ref).map(x=>structuredClone(x)),
    currentHead:async key=>heads.get(key)||null,
    appendCapture:async(e,b)=>{if(!bind(b))return false;rows.push(structuredClone(e));return true},
    advanceHead:async b=>bind(b)};
}
const historical=()=>({
  merchant:'Jarir',providerMarket:'jarir-sa',sourceUrl:URL,
  title:'Old PS5 listing',productPrice:2500,currency:'SAR',sku:'668751',
  specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White',barcode:'unsupported'},
  condition:'new',availability:'in_stock',
  image:'https://static.jarir.com/old.jpg'
});
function page({price=2529,recordId='a'.repeat(64),stamp=CLOCK-1000}={}){
  const fields=Object.fromEntries(['offers','name','sku','mpn','image','brand','color']
    .map(key=>[key,{strategy:'jsonld',recordId}]));
  return {
    provider:'url-resolver',dataKind:'live',merchant:'Jarir',
    resolvedPageUrl:URL,sourceUrl:URL,observedAt:new Date(stamp).toISOString(),
    title:'Sony PS5 Slim Disc Console',sku:'668751',gtin:null,
    productPrice:price,originalProductPrice:price,currency:'SAR',originalCurrency:'SAR',
    specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White'},
    image:'https://static.jarir.com/668751.jpg',availability:'in_stock',condition:'new',
    extraction:{selectedProductRecord:{
      recordId,documentDigest:'b'.repeat(64),source:'jsonld_product_offer',
      selectedCount:1,productCount:1,selectedProductUrl:URL,selectedOfferUrl:URL},
      reconciled:false,availableStrategies:['jsonld'],
      identity:{summary:{accepted:1,rejected:0}},
      conflictSummary:{hasConflicts:false},fieldSources:fields}
  };
}
async function issue(subject=page(),time=CLOCK){
  const session=createPdpObservationSession({readSelectedPage:async()=>subject,now:()=>time});
  const result=await session.verifySelectedRevision(historical());
  assert.equal(result.state,'VERIFIED',result.reason);
  return result;
}
const build=(st,active='k1',keys={k1:K1,k2:K2},time=CLOCK)=>
  createTrustedObservationJournal({store:st,keyring:ring(active,keys),
    requireCurrentHead:true,now:()=>time});
test('v21.66 strict source head rejects signed replay after later source revision',async()=>{
  const st=memory(),old=await issue(),reader=build(st);
  const archived=await reader.archive(old);
  assert.equal(archived.state,'ARCHIVED');
  const verified=await build(st).inspect(archived.receiptRef);
  assert.equal(verified.state,'REVALIDATED');
  assert.equal(verified.badgeEligible,false);
  const key=[...st.heads.keys()][0],initial=st.heads.get(key);
  assert.equal(await st.advanceHead({sourceKey:key,
    observedAt:new Date(CLOCK+1000).toISOString(),
    revision:'c'.repeat(64),recordId:'d'.repeat(64)}),true);
  const invalid=await build(st,'k2',undefined,CLOCK+2000).inspect(archived.receiptRef);
  assert.equal(invalid.state,'SUPERSEDED');
  assert.equal(invalid.eligible,false);
  assert.equal(await st.advanceHead(initial),false,'late old source cannot restore old head');
  assert.equal((await build(st).inspect(archived.receiptRef)).state,'SUPERSEDED');
});
test('v21.66 equal-clock conflicting source observations quarantine every prior receipt',async()=>{
  const st=memory(),journal=build(st),issued=await issue();
  const {receiptRef}=await journal.archive(issued);
  const key=[...st.heads.keys()][0],prev=st.heads.get(key);
  assert.equal(await st.advanceHead({...prev,revision:'f'.repeat(64)}),false);
  assert.equal((await journal.inspect(receiptRef)).reason,'source_head_conflict');
  assert.equal((await journal.inspect(receiptRef)).state,'CONFLICTING_EVIDENCE');
});
test('v21.66 missing or unreachable current source head fails closed',async()=>{
  const st=memory(),journal=build(st),issued=await issue();
  const {receiptRef}=await journal.archive(issued);
  st.heads.clear();
  assert.equal((await journal.inspect(receiptRef)).state,'SOURCE_BLOCKED');
  st.currentHead=async()=>{throw Error('database unavailable')};
  assert.equal((await journal.inspect(receiptRef)).reason,'source_head_read_unavailable');
});
test('v21.66 key rotation accepts retained key ID, issues new ID, and revokes removed key',async()=>{
  const st=memory(),old=await issue(),v1=build(st,'k1');
  const archived=await v1.archive(old);
  assert.equal(st.rows[0].keyId,'k1');
  assert.equal((await build(st,'k2').inspect(archived.receiptRef)).state,'REVALIDATED');
  const v2=build(st,'k2'),second=await v2.archive(old);
  assert.equal(second.state,'ARCHIVED');
  assert.equal(st.rows[1].keyId,'k2');
  assert.equal((await build(st,'k2',{k2:K2}).inspect(second.receiptRef)).state,'REVALIDATED');
  assert.equal((await build(st,'k2',{k2:K2}).inspect(archived.receiptRef)).state,
    'CONFLICTING_EVIDENCE');
  st.rows[1].keyId='k1';
  assert.equal((await build(st,'k2').inspect(second.receiptRef)).reason,'journal_integrity_failure');
  assert.equal(st.rows.some(r=>JSON.stringify(r).includes(K1)||JSON.stringify(r).includes(K2)),
    false,'secrets are never saved in receipt rows');
});
test('v21.66 keys must come from explicit private configuration, no built-in fallback',()=>{
  assert.throws(()=>trustedJournalKeyringFromEnv({}),/not_configured/);
  assert.throws(()=>trustedJournalKeyringFromEnv({
    NAWAA_TRUST_JOURNAL_ACTIVE_KEY_ID:'k1',
    NAWAA_TRUST_JOURNAL_PRIVATE_KEYS_JSON:'{"k1":"weak"}'
  }),/invalid_private/);
  const env={NAWAA_TRUST_JOURNAL_ACTIVE_KEY_ID:'k2',
    NAWAA_TRUST_JOURNAL_PRIVATE_KEYS_JSON:JSON.stringify({k1:K1,k2:K2})};
  const config=trustedJournalKeyringFromEnv(env);
  assert.equal(config.activeKeyId,'k2');
  assert.equal(config.get('k1').toString(),K1);
  assert.equal(config.get('missing'),null);
  assert.throws(()=>createTrustedObservationJournal({
    store:memory(),signingKey:K1,keyring:config
  }),/ambiguous_journal_key_authority/);
});

test('v21.66 production mode never permits a legacy signer or headless journal',()=>{
  const original=process.env.NODE_ENV;
  try{
    process.env.NODE_ENV='production';
    assert.throws(()=>createTrustedObservationJournal({
      store:memory(),signingKey:K1,requireCurrentHead:true
    }),/production_journal_requires/);
    assert.throws(()=>createTrustedObservationJournal({
      store:memory(),keyring:ring('k1'),requireCurrentHead:false
    }),/production_journal_requires/);
    const secured=createTrustedObservationJournal({
      store:memory(),keyring:ring('k1'),requireCurrentHead:true
    });
    assert.equal(secured.policyVersion,'trusted-pdp-journal-v1');
  }finally{
    if(original===undefined)delete process.env.NODE_ENV;
    else process.env.NODE_ENV=original;
  }
});

test('v21.67 controlled selected PDP refresh supersedes archived predecessor without minting a badge',async()=>{
  const st=memory(),initial=await issue(page({price:2529,stamp:CLOCK-1000}),CLOCK);
  const journal=build(st);
  const archived=await journal.archive(initial);
  assert.equal(archived.state,'ARCHIVED');
  const retained=st.rows.length;
  assert.equal((await journal.inspect(archived.receiptRef)).state,'REVALIDATED');
  const refreshed=await issue(page({price:2349,stamp:CLOCK+4000,
    recordId:'d'.repeat(64)}),CLOCK+5000);
  const second=build(st,'k1',undefined,CLOCK+5000);
  const advance=await second.recordFreshSource(refreshed);
  assert.equal(advance.state,'RECORDED',advance.reason);
  assert.equal(advance.badgeEligible,false);
  assert.equal(st.rows.length,retained,'source update must not mint a receipt');
  assert.equal((await second.inspect(archived.receiptRef)).state,'SUPERSEDED');
  assert.equal((await second.inspect(archived.receiptRef)).eligible,false);
  const other=await second.archive(refreshed);
  assert.equal(other.state,'ARCHIVED');
  assert.equal((await second.inspect(other.receiptRef)).state,'REVALIDATED');
  assert.equal((await second.inspect(other.receiptRef)).badgeEligible,false);
  const older=await second.recordFreshSource(initial);
  assert.equal(older.state,'SUPERSEDED','replay of old genuine receipt cannot roll back source head');
  assert.equal((await second.inspect(other.receiptRef)).state,'REVALIDATED');
});
test('v21.67 arbitrary listings, copied receipts and fake new-source decisions cannot advance source head',async()=>{
  const st=memory(),j=build(st),original=await issue(),archived=await j.archive(original);
  const prior=structuredClone([...st.heads.values()][0]);
  for(const input of [
    historical(),structuredClone(original),{...original},
    {...original,offer:{...original.offer,productPrice:1}},
    {state:'VERIFIED',badgeEligible:false,decision:{state:'VERIFIED'},offer:historical()}
  ]){
    const ret=await j.recordFreshSource(input);
    assert.equal(ret.state,'MISSING_EVIDENCE');
  }
  assert.deepEqual([...st.heads.values()][0],prior);
  assert.equal((await j.inspect(archived.receiptRef)).state,'REVALIDATED');
});
test('v21.67 source refresh fails closed on missing store method and source head outage',async()=>{
  const st=memory(),issued=await issue();
  const headless=createTrustedObservationJournal({store:st,signingKey:K1,
    requireCurrentHead:false,now:()=>CLOCK});
  assert.equal((await headless.recordFreshSource(issued)).state,'SOURCE_BLOCKED');
  const broken=build(st),original=st.advanceHead;
  st.advanceHead=async()=>{throw new Error('postgres down')};
  assert.equal((await broken.recordFreshSource(issued)).reason,'source_head_write_failed');
  st.advanceHead=original;
  assert.equal((await broken.recordFreshSource(issued)).state,'RECORDED');
});


test('v21.72 signed scoped journal persists reconstructible selected source values and field ownership',async()=>{
  const st=memory(),journal=build(st),controlled=await issue();
  const archived=await journal.archive(controlled);
  assert.equal(archived.state,'ARCHIVED',archived.reason);
  const reopened=await build(st).inspect(archived.receiptRef);
  assert.equal(reopened.state,'REVALIDATED',reopened.reason);
  assert.equal(reopened.scope,'selected_pdp_revision_predicates');
  assert.equal(reopened.wholeOfferVerified,false);
  assert.equal(reopened.badgeEligible,false);
  assert.equal(reopened.sourceEvidence.schema,'selected-source-record-evidence-v1');
  assert.equal(reopened.sourceEvidence.record.sku,'668751');
  assert.equal(reopened.sourceEvidence.record.productPrice,2529);
  assert.equal(reopened.sourceEvidence.record.currency,'SAR');
  assert.equal(reopened.sourceEvidence.ownership.offers.recordId,'a'.repeat(64));
  assert.equal(reopened.sourceEvidence.ownership.name.recordId,'a'.repeat(64));
  // A matching record digest is diagnostic; it is not independent authority.
  st.rows[0].payload=st.rows[0].payload.replace('"productPrice":2529','"productPrice":199');
  assert.equal((await build(st).inspect(archived.receiptRef)).state,'CONFLICTING_EVIDENCE');
});
