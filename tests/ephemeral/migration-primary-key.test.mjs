import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('existing receipts table with correct columns but no primary key fails without writes',async()=>{
 const pool=createEphemeralPool();
 try {
  await pool.query('CREATE TABLE nawaa_v2_receipts(ingestion_id uuid NOT NULL, offer_key text NOT NULL, content_digest text NOT NULL)');
  await pool.query("INSERT INTO nawaa_v2_receipts VALUES('00000000-0000-0000-0000-000000000001','keep','digest')");
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_v2_receipts.primary_key/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_v2_receipts')).rows[0].n,1);
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_schema_migrations') AS t")).rows[0].t,null);
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_offer_v2') AS t")).rows[0].t,null);
 }finally{await pool.end()}
});
