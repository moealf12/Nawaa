import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('observation FK with CASCADE delete is incompatible and replay makes no writes',async()=>{
 const pool=createEphemeralPool();
 try{
  assert.equal((await rehearseV2Migrations(pool)).applied.length,4);
  await pool.query('ALTER TABLE nawaa_observation_v2 DROP CONSTRAINT nawaa_observation_v2_offer_key_fkey');
  await pool.query('ALTER TABLE nawaa_observation_v2 ADD CONSTRAINT nawaa_observation_v2_offer_key_fkey FOREIGN KEY (offer_key) REFERENCES nawaa_offer_v2(offer_key) ON DELETE CASCADE');
  const before=(await pool.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows;
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_observation_v2.offer_foreign_key/);
  const after=(await pool.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows;
  assert.deepEqual(after,before);
 }finally{await pool.end()}
});
