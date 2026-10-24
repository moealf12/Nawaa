// Real PostgreSQL cross-process PDP receipt/revocation certification.
// Strict disposable CI only: no production schema, credentials, or live claim.
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {createIsolatedTrustedJournalStore,CI_SIGNING_KEY} from './trusted-journal-ci-store.mjs';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';

const stage=process.argv[2];
if(!['write','read','revoked'].includes(stage))throw Error('journal_stage_required');
const db=createIsolatedTrustedJournalStore();
const {pool,store,initialize}=db;
const table='nawaa_ci_trusted_journal';
const key=CI_SIGNING_KEY;
const checkpoint='.trusted-journal-stage.json';
const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
async function write(){
  await initialize();
  const observedAt=new Date(Date.now()-800).toISOString();
  const recordId='a'.repeat(64),documentDigest='b'.repeat(64);
  const owned=Object.fromEntries(['name','offers','sku','mpn','image','brand','color']
    .map(name=>[name,{strategy:'jsonld',recordId}]));
  const page={
    provider:'url-resolver',dataKind:'live',merchant:'Jarir',
    resolvedPageUrl:URL,sourceUrl:URL,observedAt,
    title:'Sony PS5 Slim Disc Console',productPrice:2529,
    originalProductPrice:2529,currency:'SAR',originalCurrency:'SAR',
    image:'https://static.jarir.com/668751.jpg',sku:'668751',
    condition:'new',availability:'in_stock',
    specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White'},
    extraction:{
      selectedProductRecord:{recordId,documentDigest,source:'jsonld_product_offer',
        selectedCount:1,productCount:1,selectedProductUrl:URL,selectedOfferUrl:URL},
      reconciled:false,availableStrategies:['jsonld'],
      identity:{summary:{accepted:1,rejected:0}},
      conflictSummary:{hasConflicts:false},fieldSources:owned
    }
  };
  const input={
    providerMarket:'jarir-sa',merchant:'Jarir',sourceUrl:URL,
    title:'stale catalog listing',productPrice:2400,currency:'SAR',
    sku:'668751',condition:'new',availability:'in_stock',
    image:'https://static.jarir.com/old.jpg',
    specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White',
      barcode:'historic-unsupported-barcode'}
  };
  const session=createPdpObservationSession({readSelectedPage:async()=>page});
  const result=await session.verifySelectedRevision(input);
  assert.equal(result.state,'VERIFIED',result.reason);
  assert.equal(result.historicalClaims.barcode,'MISSING_EVIDENCE');
  assert.equal(result.badgeEligible,false);
  const journal=createTrustedObservationJournal({store,signingKey:key,requireCurrentHead:true});
  const receipt=await journal.archive(result);
  assert.equal(receipt.state,'ARCHIVED');
  const second=await journal.archive(result);
  assert.equal(second.state,'ARCHIVED');
  assert.equal((await journal.inspect(receipt.receiptRef)).state,'REVALIDATED');
  assert.equal((await journal.inspect(second.receiptRef)).state,'REVALIDATED');
  await writeFile(checkpoint,JSON.stringify({ref:receipt.receiptRef,
    alternateRef:second.receiptRef,offer:result.offer,
    observedAt,sourceRevision:receipt.sourceRevision})+'\n');
  console.log('TRUSTED_JOURNAL_PG_WRITE '+JSON.stringify({
    testOnly:true,fixtureMerchantEvidence:true,
    sourceRecordVerifiedByOriginalSession:true,issued:true,
    wholeOfferVerified:false,badgeEligible:false
  }));
}
async function read(){
  const saved=JSON.parse(await readFile(checkpoint,'utf8'));
  const journal=createTrustedObservationJournal({store,signingKey:key,requireCurrentHead:true});
  const valid=await journal.inspect(saved.ref,{expectedOffer:saved.offer});
  assert.equal(valid.state,'REVALIDATED',valid.reason);
  assert.equal(valid.predicates.gtin,'NOT_CLAIMED');
  // Independent Node process reconstructs source facts and field ownership
  // from the signed PostgreSQL receipt, NOT from the original WeakMap.
  assert.equal(valid.sourceEvidence.schema,'selected-source-record-evidence-v1');
  assert.equal(valid.sourceEvidence.record.sku,saved.offer.sku);
  assert.equal(valid.sourceEvidence.record.productPrice,saved.offer.productPrice);
  assert.equal(valid.sourceEvidence.record.currency,saved.offer.currency);
  assert.equal(valid.sourceEvidence.ownership.offers.recordId,'a'.repeat(64));
  assert.equal(valid.sourceEvidence.ownership.image.recordId,'a'.repeat(64));
  assert.equal(valid.badgeEligible,false);
  assert.equal((await journal.inspect(saved.ref,{
    expectedOffer:{...saved.offer,productPrice:saved.offer.productPrice+100}
  })).reason,'offer_revision_mismatch');
  assert.equal((await journal.revoke(saved.ref,'source_updated')).state,'REVOKED');
  assert.equal((await journal.inspect(saved.alternateRef)).state,'REVALIDATED');
  // A new genuine trusted verifier decision from a CONTROLLED synthetic PDP
  // source must advance the head; incoming search JSON cannot update it.
  const latest=(await store.events(saved.alternateRef)).find(x=>x.kind==='capture');
  const payload=JSON.parse(latest.payload);
  const ownedId='d'.repeat(64),original=saved.offer;
  const observedAt=new Date(Date.now()).toISOString();
  const ownership=Object.fromEntries(
    ['name','offers','sku','mpn','image','brand','color']
      .map(k=>[k,{strategy:'jsonld',recordId:ownedId}]));
  const selected={
    provider:'url-resolver',dataKind:'live',merchant:'Jarir',
    resolvedPageUrl:original.sourceUrl,sourceUrl:original.sourceUrl,
    observedAt,title:original.title,sku:original.sku,
    productPrice:original.productPrice+40,
    originalProductPrice:original.productPrice+40,
    currency:'SAR',originalCurrency:'SAR',
    image:original.image,condition:original.condition,availability:original.availability,
    specs:original.specs,
    extraction:{
      selectedProductRecord:{recordId:ownedId,documentDigest:'e'.repeat(64),
        source:'jsonld_product_offer',selectedCount:1,productCount:1,
        selectedProductUrl:original.sourceUrl,selectedOfferUrl:original.sourceUrl},
      reconciled:false,availableStrategies:['jsonld'],
      identity:{summary:{accepted:1,rejected:0}},
      conflictSummary:{hasConflicts:false},fieldSources:ownership
    }
  };
  const session=createPdpObservationSession({readSelectedPage:async()=>selected});
  const updated=await session.verifySelectedRevision(original);
  assert.equal(updated.state,'VERIFIED',updated.reason);
  const incoming=await journal.recordFreshSource(updated);
  assert.equal(incoming.state,'RECORDED',incoming.reason);
  assert.equal(incoming.eligible,false);
  assert.equal((await journal.inspect(saved.alternateRef)).state,'SUPERSEDED');
  assert.equal(await store.advanceHead({
    sourceKey:payload.sourceKey,
    observedAt:new Date(Date.parse(saved.observedAt)-1000).toISOString(),
    revision:saved.sourceRevision,recordId:'a'.repeat(64)
  }),false,'older out-of-order observations cannot roll back latest head');
  console.log('TRUSTED_JOURNAL_PG_READ '+JSON.stringify({
    separateNodeProcess:true,realPostgres:true,signedReceiptValidated:true,
    alteredOfferRejected:true,revocationCommitted:true,
    controlledSelectedPdpRefresh:true,fixtureMerchantEvidence:true,
    sourceHeadAdvanced:true,olderReceiptSuperseded:true,
    outOfOrderRollbackRejected:true,badgeEligible:false
  }));
}
async function revoked(){
  const saved=JSON.parse(await readFile(checkpoint,'utf8'));
  const journal=createTrustedObservationJournal({store,signingKey:key,requireCurrentHead:true});
  const verdict=await journal.inspect(saved.ref);
  assert.equal(verdict.state,'REVOKED');
  assert.equal(verdict.badgeEligible,false);
  const superseded=await journal.inspect(saved.alternateRef);
  assert.equal(superseded.state,'SUPERSEDED');
  assert.equal(superseded.badgeEligible,false);
  const rows=await pool.query('SELECT kind FROM '+table+' WHERE receipt_ref=$1 ORDER BY id',[saved.ref]);
  assert.deepEqual(rows.rows.map(r=>r.kind),['capture','revoke']);
  await assert.rejects(pool.query('DELETE FROM '+table+' WHERE receipt_ref=$1',[saved.ref]),
    /append-only trusted journal/);
  console.log('TRUSTED_JOURNAL_PG_REVOKED '+JSON.stringify({
    thirdNodeProcess:true,realPostgres:true,
    revocationSurvivesProcessRestart:true,sourceSupersessionSurvivesRestart:true,
    deleteBlocked:true
  }));
}
try{
  if(stage==='write')await write();
  else if(stage==='read')await read();
  else await revoked();
}finally{
  await db.close();
}
