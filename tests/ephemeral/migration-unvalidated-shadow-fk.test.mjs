import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('unvalidated shadow attempt FK rejects replay before migration ledger writes',async()=>{
 const pool=createEphemeralPool();
 try{
  const installed=await rehearseV2Migrations(pool);
  assert.equal(installed.applied.length,4);
  await pool.query('ALTER TABLE nawaa_v2_shadow_attempts DROP CONSTRAINT nawaa_v2_shadow_attempts_event_id_fkey');
  await pool.query('ALTER TABLE nawaa_v2_shadow_attempts ADD CONSTRAINT nawaa_v2_shadow_attempts_event_id_fkey FOREIGN KEY(event_id) REFERENCES nawaa_v2_shadow_outbox(event_id) NOT VALID');
  const check=await pool.query("SELECT convalidated FROM pg_constraint WHERE conrelid='nawaa_v2_shadow_attempts'::regclass AND conname='nawaa_v2_shadow_attempts_event_id_fkey'");
  assert.equal(check.rows[0].convalidated,false);
  const before=(await pool.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows;
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_v2_shadow_attempts.event_foreign_key/);
  assert.deepEqual((await pool.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows,before);
 }finally{await pool.end()}
});
