import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {initPersistence} from '../../server/persistence.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

// Dedicated CI suite: schema reset by workflow before this file.
test('additive V2 migration retains legacy rows and supports idempotent upgrade',async()=>{
 const pool=createEphemeralPool();
 try{
  await initPersistence();
  await pool.query("INSERT INTO nawaa_offers(offer_key,title,source_url,payload) VALUES($1,$2,$3,$4::jsonb)",[
   'upgrade-ci|new','Upgrade fixture','https://example.com/upgrade','{}'
  ]);
  const before=(await pool.query('SELECT id,offer_key,title,source_url,payload FROM nawaa_offers ORDER BY id')).rows;
  const outcome=await rehearseV2Migrations(pool);
  assert.deepEqual(outcome.applied,['v2_0001','v2_0002','v2_0003','v2_0004']);
  assert.deepEqual((await pool.query('SELECT id,offer_key,title,source_url,payload FROM nawaa_offers ORDER BY id')).rows,before);
  assert.deepEqual(await rehearseV2Migrations(pool),{applied:[],skipped:4});
  for(const table of ['nawaa_offer_v2','nawaa_observation_v2','nawaa_v2_receipts','nawaa_v2_shadow_outbox','nawaa_v2_shadow_attempts','nawaa_v2_backfill_progress']){
   assert.notEqual((await pool.query('SELECT to_regclass($1) AS t',['public.'+table])).rows[0].t,null);
  }
 }finally{await pool.end()}
});
