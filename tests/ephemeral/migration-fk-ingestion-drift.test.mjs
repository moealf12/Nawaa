import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('shadow attempt FK DELETE CASCADE drift rejected before migration writes',async()=>{
 const p=createEphemeralPool();
 try{
  assert.equal((await rehearseV2Migrations(p)).applied.length,4);
  await p.query('ALTER TABLE nawaa_v2_shadow_attempts DROP CONSTRAINT nawaa_v2_shadow_attempts_event_id_fkey');
  await p.query('ALTER TABLE nawaa_v2_shadow_attempts ADD CONSTRAINT nawaa_v2_shadow_attempts_event_id_fkey FOREIGN KEY(event_id) REFERENCES nawaa_v2_shadow_outbox(event_id) ON DELETE CASCADE');
  const before=(await p.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows;
  await assert.rejects(rehearseV2Migrations(p),/incompatible_existing_schema:nawaa_v2_shadow_attempts.event_foreign_key/);
  assert.deepEqual((await p.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows,before);
 }finally{await p.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');await p.end()}
});

test('missing ingestion unique index is rejected on migrated observation table',async()=>{
 const p=createEphemeralPool();
 try{
  assert.equal((await rehearseV2Migrations(p)).applied.length,4);
  await p.query('ALTER TABLE nawaa_observation_v2 DROP CONSTRAINT nawaa_observation_v2_ingestion_id_key');
  await assert.rejects(rehearseV2Migrations(p),/incompatible_existing_schema:nawaa_observation_v2.ingestion_unique/);
  assert.equal((await p.query('SELECT count(*)::int AS n FROM nawaa_schema_migrations')).rows[0].n,4);
 }finally{await p.end()}
});
