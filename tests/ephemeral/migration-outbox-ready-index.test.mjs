import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';
test('outbox ready index wrong column order rejected without ledger mutation',async()=>{
 const p=createEphemeralPool();
 try{
  assert.equal((await rehearseV2Migrations(p)).applied.length,4);
  await p.query('DROP INDEX nawaa_v2_shadow_outbox_ready');
  await p.query('CREATE INDEX nawaa_v2_shadow_outbox_ready ON nawaa_v2_shadow_outbox(next_attempt_at,status)');
  const baseline=(await p.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows;
  await assert.rejects(rehearseV2Migrations(p),/incompatible_existing_schema:nawaa_v2_shadow_outbox.ready_index/);
  assert.deepEqual((await p.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows,baseline);
 }finally{await p.end()}
});
