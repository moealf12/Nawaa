import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

// Isolated ephemeral PG16 suite: no deployment/production access.
test('unreachable RAISE in observation trigger body must fail preflight without replay writes',async()=>{
 const pool=createEphemeralPool();
 try{
  assert.equal((await rehearseV2Migrations(pool)).applied.length,4);
  await pool.query(`INSERT INTO nawaa_offer_v2
    (offer_key,source_id,source_url,condition,product_price,currency,observed_at,payload)
    VALUES('trigger-drift','ci','https://example.test/drift','new',10,'SAR',now(),'{}')`);
  await pool.query(`INSERT INTO nawaa_observation_v2
    (offer_key,ingestion_id,source_id,product_price,currency,observed_at)
    VALUES('trigger-drift','00000000-0000-4000-8000-000000000001','ci',10,'SAR',now())`);
  // This is a legal PostgreSQL function replacement: the expected exception text
  // remains, but UPDATE no longer raises. Previous substring checks accept it.
  await pool.query(`CREATE OR REPLACE FUNCTION public.nawaa_v2_reject_observation_change()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF false THEN RAISE EXCEPTION 'v2_observations_immutable'; END IF;
      RETURN NEW;
    END; $$`);
  const tx=await pool.connect();
  try{
   await tx.query('BEGIN');
   await tx.query("UPDATE nawaa_observation_v2 SET product_price=17 WHERE offer_key='trigger-drift'");
   const mutated=await tx.query("SELECT product_price::text AS price FROM nawaa_observation_v2 WHERE offer_key='trigger-drift'");
   assert.equal(mutated.rows[0].price,'17','negative control must demonstrate mutable trigger');
  }finally{await tx.query('ROLLBACK');tx.release()}
  const ledgerBefore=(await pool.query('SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version')).rows;
  const before=(await pool.query("SELECT ingestion_id,offer_key,product_price::text AS price FROM nawaa_observation_v2 ORDER BY ingestion_id")).rows;
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_observation_v2.immutable_trigger/);
  assert.deepEqual((await pool.query('SELECT version,checksum_sha256,applied_at,applied_by FROM nawaa_schema_migrations ORDER BY version')).rows,ledgerBefore);
  assert.deepEqual((await pool.query("SELECT ingestion_id,offer_key,product_price::text AS price FROM nawaa_observation_v2 ORDER BY ingestion_id")).rows,before);
  assert.equal(before[0].price,'10');
 }finally{await pool.end()}
});
