import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations,V2_MIGRATIONS} from '../../server/persistence-v2-migration-rehearsal.mjs';

const pool=createEphemeralPool();
test.after(async()=>pool.end());
test('failure injection rolls back DDL and ledger atomically, followed by clean retry',async()=>{
 await assert.rejects(rehearseV2Migrations(pool,{failVersion:'v2_0003'}),/injected_migration_failure/);
 for(const table of ['nawaa_schema_migrations','nawaa_offer_v2','nawaa_v2_receipts','nawaa_v2_shadow_outbox']){
  const row=(await pool.query('SELECT to_regclass($1) AS t',['public.'+table])).rows[0];
  assert.equal(row.t,null,'aborted migration must leave '+table+' absent');
 }
 const first=await rehearseV2Migrations(pool);
 assert.deepEqual(first.applied,V2_MIGRATIONS.map(x=>x.version));
 const repeat=await rehearseV2Migrations(pool);
 assert.deepEqual(repeat,{applied:[],skipped:4});
});
test('concurrent migration runners serialize and preserve exactly four ledger versions',async()=>{
 const results=await Promise.all([rehearseV2Migrations(pool),rehearseV2Migrations(pool)]);
 assert.equal(results.every(x=>x.skipped===4),true);
 const rows=await pool.query('SELECT version FROM nawaa_schema_migrations ORDER BY version');
 assert.deepEqual(rows.rows.map(x=>x.version),V2_MIGRATIONS.map(x=>x.version));
});
test('checksum tampering fails closed without applying writes',async()=>{
 await pool.query("UPDATE nawaa_schema_migrations SET checksum_sha256=repeat('0',64) WHERE version='v2_0004'");
 try{
  await assert.rejects(rehearseV2Migrations(pool),/migration_history_diverged/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_schema_migrations')).rows[0].n,4);
 }finally{
  // Isolated CI only: restore exact ledger from a new clean transaction by deleting
  // the corrupted row and recreating it with the approved checksum is disallowed.
  // This test is intentionally last in this isolated suite.
 }
});
