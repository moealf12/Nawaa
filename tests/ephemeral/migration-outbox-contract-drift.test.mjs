import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

// Each fixture rebuilds its own public schema inside the allowlisted CI PostgreSQL.
test('critical status/outcome CHECK and scheduling DEFAULT drift fail before replay writes',async()=>{
 const pool=createEphemeralPool();
 const cases=[
  {name:'outbox status CHECK removed',sql:'ALTER TABLE nawaa_v2_shadow_outbox DROP CONSTRAINT nawaa_v2_shadow_outbox_status_check',error:/incompatible_existing_schema:nawaa_v2_shadow_outbox.check_status/},
  {name:'shadow attempts outcome CHECK removed',sql:'ALTER TABLE nawaa_v2_shadow_attempts DROP CONSTRAINT nawaa_v2_shadow_attempts_outcome_check',error:/incompatible_existing_schema:nawaa_v2_shadow_attempts.check_outcome/},
  {name:'backfill outcome CHECK removed',sql:'ALTER TABLE nawaa_v2_backfill_progress DROP CONSTRAINT nawaa_v2_backfill_progress_outcome_check',error:/incompatible_existing_schema:nawaa_v2_backfill_progress.check_outcome/},
  {name:'next attempt scheduling DEFAULT changed',sql:"ALTER TABLE nawaa_v2_shadow_outbox ALTER COLUMN next_attempt_at SET DEFAULT '2000-01-01'::timestamptz",error:/incompatible_existing_schema:nawaa_v2_shadow_outbox.default_next_attempt_at/}
 ];
 try{
  for(const scenario of cases){
   // Reset completely between fixtures; no negative control depends on a preceding one.
   await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
   assert.equal((await rehearseV2Migrations(pool)).applied.length,4,scenario.name);
   await pool.query(`INSERT INTO nawaa_v2_shadow_outbox(event_id,offer)
     VALUES('00000000-0000-4000-8000-000000000011','{"source":"fixture"}'::jsonb)`);
   const beforeLedger=(await pool.query('SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version')).rows;
   const beforeOutbox=(await pool.query('SELECT event_id,offer::text,status,attempts,max_attempts,next_attempt_at FROM nawaa_v2_shadow_outbox ORDER BY event_id')).rows;
   await pool.query(scenario.sql);
   await assert.rejects(rehearseV2Migrations(pool),scenario.error,scenario.name);
   assert.deepEqual((await pool.query('SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version')).rows,beforeLedger,scenario.name+' ledger');
   assert.deepEqual((await pool.query('SELECT event_id,offer::text,status,attempts,max_attempts,next_attempt_at FROM nawaa_v2_shadow_outbox ORDER BY event_id')).rows,beforeOutbox,scenario.name+' rows');
  }
 }finally{await pool.end()}
});
