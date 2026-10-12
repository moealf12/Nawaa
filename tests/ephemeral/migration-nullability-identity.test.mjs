import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('nullable receipt offer identity is rejected before any migration ledger write',async()=>{
 const pool=createEphemeralPool();
 try{
  await pool.query(`CREATE TABLE nawaa_v2_receipts(ingestion_id uuid PRIMARY KEY,offer_key text,content_digest text NOT NULL)`);
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_v2_receipts.not_null.offer_key/);
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_schema_migrations') AS t")).rows[0].t,null);
 }finally{await pool.end()}
});

test('existing observation table missing identity generation rejects replay without mutation',async()=>{
 const pool=createEphemeralPool();
 try{
  await rehearseV2Migrations(pool);
  const baseline=(await pool.query("SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version")).rows;
  await pool.query('ALTER TABLE nawaa_observation_v2 ALTER COLUMN id DROP IDENTITY');
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_observation_v2.identity/);
  assert.deepEqual((await pool.query("SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version")).rows,baseline);
 }finally{await pool.end()}
});
