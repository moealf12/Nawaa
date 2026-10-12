import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

// CI resets the entire public schema for each isolated suite.
test('attempt table missing event claim uniqueness rejects without touching rows',async()=>{
 const pool=createEphemeralPool();
 try{
  await pool.query(`CREATE TABLE nawaa_v2_shadow_outbox(event_id uuid PRIMARY KEY,offer jsonb NOT NULL,status text NOT NULL,attempts integer NOT NULL,max_attempts integer NOT NULL,next_attempt_at timestamptz NOT NULL,lease_until timestamptz,claim_token uuid)`);
  await pool.query(`CREATE TABLE nawaa_v2_shadow_attempts(
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES nawaa_v2_shadow_outbox(event_id),
    claim_token uuid NOT NULL,attempt integer NOT NULL,outcome text NOT NULL)`);
  await pool.query("INSERT INTO nawaa_v2_shadow_outbox(event_id) VALUES('00000000-0000-0000-0000-000000000002','{}','pending',0,3,now(),NULL,NULL)");
  await pool.query("INSERT INTO nawaa_v2_shadow_attempts(event_id,claim_token,attempt,outcome) VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',1,'retry')");
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_v2_shadow_attempts.unique_event_claim/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_v2_shadow_attempts')).rows[0].n,1);
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_schema_migrations') AS t")).rows[0].t,null);
 }finally{await pool.end()}
});
