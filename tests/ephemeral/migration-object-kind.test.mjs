import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('preexisting view masquerading as receipt table fails closed without V2 DDL',async()=>{
 const pool=createEphemeralPool();
 try{
  await pool.query("CREATE VIEW nawaa_v2_receipts AS SELECT '00000000-0000-0000-0000-000000000001'::uuid AS ingestion_id, 'offer'::text AS offer_key, 'digest'::text AS content_digest");
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_v2_receipts.object_kind/);
  assert.equal((await pool.query("SELECT relkind FROM pg_class WHERE oid=to_regclass('public.nawaa_v2_receipts')")).rows[0].relkind,'v');
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_schema_migrations') AS t")).rows[0].t,null);
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_offer_v2') AS t")).rows[0].t,null);
 }finally{await pool.end()}
});
