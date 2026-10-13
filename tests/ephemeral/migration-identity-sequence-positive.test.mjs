import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

// An isolated PG16 schema: CI resets public before each suite.
test('both GENERATED ALWAYS identities have correct internal sequence dependency, owner and actual generation',async()=>{
 const pool=createEphemeralPool();
 let client;
 try{
  const created=await rehearseV2Migrations(pool);
  assert.deepEqual(created.applied,['v2_0001','v2_0002','v2_0003','v2_0004']);
  const result=await pool.query(`SELECT t.relname AS table_name, col.attidentity, s.relname AS sequence_name,
    d.deptype, d.refobjsubid=col.attnum AS correct_column,
    t.relowner=s.relowner AS same_owner,t.relnamespace=s.relnamespace AS same_schema,
    pg_get_serial_sequence(format('%I.%I',n.nspname,t.relname),'id') AS generator
    FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute col ON col.attrelid=t.oid AND col.attname='id'
    JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass
      AND d.refobjid=t.oid AND d.refobjsubid=col.attnum AND d.deptype IN ('i','a')
    JOIN pg_class s ON s.oid=d.objid AND s.relkind='S'
    WHERE n.nspname='public' AND t.relname IN ('nawaa_observation_v2','nawaa_v2_shadow_attempts')
    ORDER BY t.relname`);
  assert.equal(result.rows.length,2);
  for(const r of result.rows){
   assert.equal(r.attidentity,'a');
   assert.equal(r.deptype,'i');
   assert.equal(r.correct_column,true);
   assert.equal(r.same_owner,true);
   assert.equal(r.same_schema,true);
   assert.equal(r.sequence_name,r.table_name+'_id_seq');
   assert.equal(r.generator,'public.'+r.sequence_name);
  }
  client=await pool.connect();
  await client.query('BEGIN');
  await client.query(`INSERT INTO nawaa_offer_v2(offer_key,source_id,source_url,condition,product_price,currency,observed_at,payload)
    VALUES('identity-positive','ci','https://example.test/identity','new',17,'SAR',now(),'{}')`);
  const observed=await client.query(`INSERT INTO nawaa_observation_v2
    (offer_key,ingestion_id,source_id,product_price,currency,observed_at)
    VALUES('identity-positive','00000000-0000-4000-8000-000000000001','ci',17,'SAR',now()) RETURNING id`);
  assert.ok(BigInt(observed.rows[0].id)>0n);
  await client.query(`INSERT INTO nawaa_v2_shadow_outbox(event_id,offer)
    VALUES('00000000-0000-4000-8000-000000000002','{}')`);
  const attempted=await client.query(`INSERT INTO nawaa_v2_shadow_attempts(event_id,claim_token,attempt,outcome)
    VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',1,'retry') RETURNING id`);
  assert.ok(BigInt(attempted.rows[0].id)>0n);
  for(const [table,sql] of [
   ['nawaa_observation_v2',`INSERT INTO nawaa_observation_v2(id,offer_key,ingestion_id,source_id,product_price,currency,observed_at) VALUES(98765,'identity-positive','00000000-0000-4000-8000-000000000004','ci',17,'SAR',now())`],
   ['nawaa_v2_shadow_attempts',`INSERT INTO nawaa_v2_shadow_attempts(id,event_id,claim_token,attempt,outcome) VALUES(98765,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000005',2,'retry')`]
  ]){
   await client.query('SAVEPOINT explicit_identity');
   await assert.rejects(client.query(sql),e=>e.code==='428C9',table+' must enforce GENERATED ALWAYS');
   await client.query('ROLLBACK TO SAVEPOINT explicit_identity');
  }
  // PG16 protects the internal identity dependency: cannot detach/re-own it.
  await client.query('SAVEPOINT ownership_mutation');
  await assert.rejects(client.query('ALTER SEQUENCE public.nawaa_observation_v2_id_seq OWNED BY NONE'),
   e=>/cannot change ownership of identity sequence/i.test(e.message),
   'PostgreSQL must reject detaching the identity-owned sequence');
  await client.query('ROLLBACK TO SAVEPOINT ownership_mutation');
  await client.query('ROLLBACK');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM nawaa_observation_v2 WHERE offer_key='identity-positive'")).rows[0].n,0);
 }finally{
  if(client){
   await client.query('ROLLBACK').catch(()=>{});
   client.release();
  }
  await pool.end();
 }
});
