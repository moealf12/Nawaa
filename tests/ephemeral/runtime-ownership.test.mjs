import test from 'node:test';
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
  const ok=await rehearseV2Migrations(pool);
  assert.equal(ok.applied.length,4);
 }finally{await pool.end()}
});
