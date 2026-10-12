import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

// Workflow resets the public schema before every test file. No production access.
test('preexisting malformed V2 table rejects without ledger or alterations',async()=>{
 const pool=createEphemeralPool();
 try {
  await pool.query('CREATE TABLE nawaa_v2_receipts(ingestion_id text PRIMARY KEY)');
  const before=(await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='nawaa_v2_receipts' ORDER BY ordinal_position")).rows;
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_v2_receipts.ingestion_id/);
  const after=(await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='nawaa_v2_receipts' ORDER BY ordinal_position")).rows;
  assert.deepEqual(after,before);
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_schema_migrations') AS t")).rows[0].t,null);
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_offer_v2') AS t")).rows[0].t,null);
 }finally{await pool.end()}
});
