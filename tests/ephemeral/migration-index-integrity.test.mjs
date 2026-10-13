import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('outbox expired claim index must preserve columns, predicate, and validity',async()=>{
 const pool=createEphemeralPool();
 try{
  const first=await rehearseV2Migrations(pool);
  assert.equal(first.applied.length,4);
  await pool.query('DROP INDEX nawaa_v2_shadow_outbox_expired');
  await pool.query("CREATE INDEX nawaa_v2_shadow_outbox_expired ON nawaa_v2_shadow_outbox(lease_until,event_id) WHERE status='completed'");
  const before=(await pool.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows;
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_v2_shadow_outbox.expired_index/);
  assert.deepEqual((await pool.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version')).rows,before);
 }finally{await pool.end()}
});
