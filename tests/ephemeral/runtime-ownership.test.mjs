import test from 'node:test';
import pg from 'pg';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('missing or mismatched owned runtime identity fails before migration DDL',async()=>{
 const env=process.env;
 assert.equal(env.GITHUB_ACTIONS,'true');
 assert.match(env.NAWAA_CI_OWNED_SERVICE_IPV4,/^\d+\.\d+\.\d+\.\d+$/);
 const pool=createEphemeralPool(env);
 try{
  for(const observed of [undefined,'192.0.2.99']){
   const wrong={...env,NAWAA_CI_OWNED_SERVICE_IPV4:observed};
   await assert.rejects(rehearseV2Migrations(pool,{env:wrong}),/ephemeral_runtime_owner_mismatch/);
   const ledger=await pool.query("SELECT to_regclass('public.nawaa_schema_migrations') AS t");
   assert.equal(ledger.rows[0].t,null);
  }
  // Reject effective target overrides before establishing any new connection.
  for(const override of [
   {...env,DATABASE_URL:'postgresql://nawaa:nawaa_ci@127.0.0.2:5432/nawaa_ci'},
   {...env,DATABASE_URL:'postgresql://nawaa:nawaa_ci@localhost:5433/nawaa_ci'},
   {...env,DATABASE_URL:'postgresql://other:nawaa_ci@localhost:5432/nawaa_ci'},
   {...env,DATABASE_URL:'postgresql://nawaa:nawaa_ci@localhost:5432/other'}
  ]){
   await assert.rejects(async()=>createEphemeralPool(override),/ephemeral_database_only/);
  }
  const ok=await rehearseV2Migrations(pool);
  assert.equal(ok.applied.length,4);
 }finally{await pool.end()}
});

test('otherwise valid nawaa_ci instance on unowned service fails actual runner attestation',async()=>{
 const unowned=new pg.Pool({connectionString:'postgresql://nawaa:nawaa_ci@127.0.0.1:5433/nawaa_ci',ssl:false,max:1,connectionTimeoutMillis:3000});
 try{
  const peer=await unowned.query("SELECT current_database() AS db, current_user AS usr,host(inet_server_addr()) AS addr");
  assert.equal(peer.rows[0].db,'nawaa_ci');
  assert.equal(peer.rows[0].usr,'nawaa');
  assert.notEqual(peer.rows[0].addr,process.env.NAWAA_CI_OWNED_SERVICE_IPV4);
  await assert.rejects(rehearseV2Migrations(unowned),/ephemeral_runtime_owner_mismatch/);
  const state=await unowned.query("SELECT to_regclass('public.nawaa_schema_migrations') AS ledger,to_regclass('public.nawaa_offer_v2') AS offers");
  assert.equal(state.rows[0].ledger,null);
  assert.equal(state.rows[0].offers,null);
 }finally{await unowned.end()}
});
