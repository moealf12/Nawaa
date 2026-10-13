import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('non-owner application role cannot bypass immutable observation trigger or change schema',async()=>{
 const p=createEphemeralPool();
 let roleCreated=false;
 try{
  await rehearseV2Migrations(p);
  await p.query("INSERT INTO nawaa_offer_v2(offer_key,source_id,source_url,condition,product_price,currency,observed_at,payload) VALUES('role-test','source','https://example.test','new',9,'SAR',now(),'{}')");
  await p.query("INSERT INTO nawaa_observation_v2(offer_key,ingestion_id,source_id,product_price,currency,observed_at) VALUES('role-test','00000000-0000-4000-8000-000000000090','source',9,'SAR',now())");
  await p.query('CREATE ROLE nawaa_ci_app_restricted NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
  roleCreated=true;
  await p.query('GRANT USAGE ON SCHEMA public TO nawaa_ci_app_restricted');
  await p.query('GRANT SELECT, UPDATE, DELETE ON nawaa_observation_v2 TO nawaa_ci_app_restricted');
  const probe=async(sql,codeOrError)=>{
   const client=await p.connect();
   try{
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE nawaa_ci_app_restricted');
    await assert.rejects(client.query(sql),error=>codeOrError==='immutable'
      ? error.message.includes('v2_observations_immutable')
      : error.code===codeOrError);
   }finally{await client.query('ROLLBACK');client.release()}
  };
  await probe('UPDATE nawaa_observation_v2 SET product_price=10 WHERE offer_key=\'role-test\'','immutable');
  await probe("DELETE FROM nawaa_observation_v2 WHERE offer_key='role-test'",'immutable');
  await probe('ALTER TABLE nawaa_observation_v2 DISABLE TRIGGER nawaa_v2_immutable','42501');
  const state=await p.query("SELECT product_price::text AS price FROM nawaa_observation_v2 WHERE offer_key='role-test'");
  assert.equal(state.rows[0].price,'9');
 }finally{
  if(roleCreated){await p.query('REVOKE ALL ON nawaa_observation_v2 FROM nawaa_ci_app_restricted');await p.query('REVOKE ALL ON SCHEMA public FROM nawaa_ci_app_restricted');await p.query('DROP ROLE nawaa_ci_app_restricted')}
  await p.end();
 }
});
