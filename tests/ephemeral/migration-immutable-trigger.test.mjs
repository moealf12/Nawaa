import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('disabled immutable observation trigger rejects replay before ledger or data writes',async()=>{
 const pool=createEphemeralPool();
 try{
  await rehearseV2Migrations(pool);
  await pool.query("INSERT INTO nawaa_offer_v2(offer_key,source_id,source_url,condition,product_price,currency,observed_at,payload) VALUES('test','source','https://example.test','new',12,'SAR',now(),'{}')");
  await pool.query("ALTER TABLE nawaa_observation_v2 DISABLE TRIGGER nawaa_v2_immutable");
  const before=(await pool.query("SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version")).rows;
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_observation_v2.immutable_trigger/);
  const after=(await pool.query("SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version")).rows;
  assert.deepEqual(after,before);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM nawaa_offer_v2")).rows[0].n,1);
 }finally{await pool.end()}
});
