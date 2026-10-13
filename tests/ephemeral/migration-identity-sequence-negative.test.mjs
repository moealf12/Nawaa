import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

// Unlike internal OWNED BY mutation (rejected by PG16), CYCLE is legal catalog drift
// and can eventually recycle primary-key values. This suite has its own fresh schema.
test('a legally altered identity sequence with CYCLE fails schema preflight without writes',async()=>{
 const pool=createEphemeralPool();
 try{
  await rehearseV2Migrations(pool);
  await pool.query(`INSERT INTO nawaa_v2_shadow_outbox(event_id,offer)
    VALUES('00000000-0000-4000-8000-000000000011','{}')`);
  const beforeLedger=(await pool.query('SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version')).rows;
  const beforeRows=(await pool.query('SELECT event_id,offer::text,status,attempts FROM nawaa_v2_shadow_outbox ORDER BY event_id')).rows;
  // This mutation is supported by PostgreSQL 16 and must not be auto-repaired.
  await pool.query('ALTER SEQUENCE public.nawaa_v2_shadow_attempts_id_seq CYCLE');
  const beforeSequence=(await pool.query(`SELECT s.seqincrement::text AS increment,s.seqcycle AS cycle,
    q.relowner=t.relowner AS same_owner
    FROM pg_sequence s JOIN pg_class q ON q.oid=s.seqrelid
    JOIN pg_class t ON t.oid='public.nawaa_v2_shadow_attempts'::regclass
    WHERE q.oid='public.nawaa_v2_shadow_attempts_id_seq'::regclass`)).rows;
  assert.equal(beforeSequence.length,1);
  assert.equal(beforeSequence[0].cycle,true);
  assert.equal(beforeSequence[0].same_owner,true);
  await assert.rejects(rehearseV2Migrations(pool),
    /incompatible_existing_schema:nawaa_v2_shadow_attempts.identity_sequence/);
  assert.deepEqual((await pool.query('SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version')).rows,beforeLedger);
  assert.deepEqual((await pool.query('SELECT event_id,offer::text,status,attempts FROM nawaa_v2_shadow_outbox ORDER BY event_id')).rows,beforeRows);
  assert.deepEqual((await pool.query(`SELECT s.seqincrement::text AS increment,s.seqcycle AS cycle,
    q.relowner=t.relowner AS same_owner
    FROM pg_sequence s JOIN pg_class q ON q.oid=s.seqrelid
    JOIN pg_class t ON t.oid='public.nawaa_v2_shadow_attempts'::regclass
    WHERE q.oid='public.nawaa_v2_shadow_attempts_id_seq'::regclass`)).rows,beforeSequence);
 }finally{await pool.end()}
});
