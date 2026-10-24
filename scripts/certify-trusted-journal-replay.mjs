// Real PostgreSQL cross-process PDP receipt/revocation certification.
// Strict disposable CI only: no production schema, credentials, or live claim.
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import pg from 'pg';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';

if(process.env.NODE_ENV!=='test'||!process.env.NAWAA_TEST_DATABASE_URL||
   process.env.DATABASE_URL&&process.env.NAWAA_TEST_DATABASE_URL===process.env.DATABASE_URL)
  throw Error('trusted_journal_disposable_postgres_only');
const stage=process.argv[2];
if(!['write','read','revoked'].includes(stage))throw Error('journal_stage_required');
const pool=new pg.Pool({connectionString:process.env.NAWAA_TEST_DATABASE_URL,ssl:false,max:2});
const table='nawaa_ci_trusted_journal';
const key='ci-only-nawaa-v21-65-private-journal-secret-unsafe-for-production';
const checkpoint='.trusted-journal-stage.json';
const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
const store={
  append:async e=>{await pool.query('INSERT INTO '+table+
    '(receipt_ref,kind,payload_text,signature) VALUES($1,$2,$3,$4)',
    [e.ref,e.kind,e.payload,e.signature])},
  events:async ref=>(await pool.query(
    'SELECT receipt_ref AS ref,kind,payload_text AS payload,signature FROM '+
    table+' WHERE receipt_ref=$1 ORDER BY id ASC',[ref])).rows
};
async function initialize(){
  await pool.query('CREATE TABLE IF NOT EXISTS '+table+'('+
    'id bigserial PRIMARY KEY,receipt_ref text NOT NULL,'+
    "kind text NOT NULL CHECK(kind IN ('capture','revoke')),"+
    'payload_text text NOT NULL,signature text NOT NULL,'+
    'inserted_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS nawaa_ci_journal_unique_capture ON '+
    table+"(receipt_ref) WHERE kind='capture'");
  await pool.query('CREATE OR REPLACE FUNCTION nawaa_ci_reject_journal_mutation() '+
    "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only trusted journal'; END; $$");
  await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_journal_immutable ON '+table);
  await pool.query('CREATE TRIGGER nawaa_ci_journal_immutable BEFORE UPDATE OR DELETE ON '+
    table+' FOR EACH ROW EXECUTE FUNCTION nawaa_ci_reject_journal_mutation()');
}
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
  const journal=createTrustedObservationJournal({store,signingKey:key});
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
  const journal=createTrustedObservationJournal({store,signingKey:key});
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
  const journal=createTrustedObservationJournal({store,signingKey:key});
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
  await pool.end();
}
