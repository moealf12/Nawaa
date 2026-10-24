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
  assert.equal((await journal.inspect(receipt.receiptRef)).state,'REVALIDATED');
  await writeFile(checkpoint,JSON.stringify({ref:receipt.receiptRef,offer:result.offer})+'\n');
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
  assert.equal(valid.badgeEligible,false);
  assert.equal((await journal.inspect(saved.ref,{
    expectedOffer:{...saved.offer,productPrice:saved.offer.productPrice+100}
  })).reason,'offer_revision_mismatch');
  assert.equal((await journal.revoke(saved.ref,'source_updated')).state,'REVOKED');
  console.log('TRUSTED_JOURNAL_PG_READ '+JSON.stringify({
    separateNodeProcess:true,realPostgres:true,signedReceiptValidated:true,
    alteredOfferRejected:true,revocationCommitted:true,badgeEligible:false
  }));
}
async function revoked(){
  const saved=JSON.parse(await readFile(checkpoint,'utf8'));
  const journal=createTrustedObservationJournal({store,signingKey:key,requireCurrentHead:true});
  const verdict=await journal.inspect(saved.ref);
  assert.equal(verdict.state,'REVOKED');
  assert.equal(verdict.badgeEligible,false);
  const rows=await pool.query('SELECT kind FROM '+table+' WHERE receipt_ref=$1 ORDER BY id',[saved.ref]);
  assert.deepEqual(rows.rows.map(r=>r.kind),['capture','revoke']);
  await assert.rejects(pool.query('DELETE FROM '+table+' WHERE receipt_ref=$1',[saved.ref]),
    /append-only trusted journal/);
  console.log('TRUSTED_JOURNAL_PG_REVOKED '+JSON.stringify({
    thirdNodeProcess:true,realPostgres:true,
    revocationSurvivesProcessRestart:true,deleteBlocked:true
  }));
}
try{
  if(stage==='write')await write();
  else if(stage==='read')await read();
  else await revoked();
}finally{
  await db.close();
}
