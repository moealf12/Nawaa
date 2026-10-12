import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {attestEphemeralConnection,initV2,recordOfferV2} from '../../server/persistence-v2.mjs';
import {initShadowOutbox,enqueueShadowIntentTx,commitLegacyAndOutbox,processShadowOutbox} from '../../server/persistence-v2-outbox.mjs';
import {backfillV2Snapshots} from '../../server/persistence-v2-backfill.mjs';
import {recordOfferWithV2Shadow} from '../../server/persistence-v2-shadow.mjs';

const base={
 sourceId:'jarir-sa',sourceUrl:'https://www.jarir.com/sa/identity/'+randomUUID(),
 sourceListingId:randomUUID(),sourceVariantId:'128',legacyOfferKey:'attest-'+randomUUID(),
 title:'DB attestation fixture',productPrice:100,currency:'SAR',
 observedAt:'2026-10-10T12:00:00Z',condition:'new',
};
const validEnv={
 NAWAA_CI_EPHEMERAL_DB:'1',
 DATABASE_URL:'postgresql://nawaa:nawaa_ci@localhost:5432/nawaa_ci',
 DATABASE_SSL:'false',
 NAWAA_PERSISTENCE_V2_SHADOW:'1',
};
const wrongDbUrl=validEnv.DATABASE_URL.replace(/\/nawaa_ci$/,'/postgres');

test('configured CI URL cannot authorize injected pool on another real database',async()=>{
 const other=new pg.Pool({connectionString:wrongDbUrl,ssl:false,max:4});
 try {
   const actual=(await other.query('SELECT current_database() AS name')).rows[0].name;
   assert.equal(actual,'postgres');
   const id=randomUUID();
   const checks=[
     ()=>initV2(other,{env:validEnv}),
     ()=>initShadowOutbox(other,{env:validEnv}),
     ()=>backfillV2Snapshots(other,{env:validEnv,stopAfter:0}),
     ()=>recordOfferV2(other,base,{env:validEnv,ingestionId:id}),
     ()=>commitLegacyAndOutbox(other,base,{env:validEnv,eventId:id}),
     ()=>processShadowOutbox(other,{env:validEnv}),
   ];
   for(const op of checks)await assert.rejects(op(),/ephemeral_database_identity_mismatch/);
   const c=await other.connect();
   try {
     await assert.rejects(enqueueShadowIntentTx(c,base,{env:validEnv,eventId:id}),/ephemeral_database_identity_mismatch/);
   }finally{c.release()}
   let legacyWrites=0;
   await assert.rejects(recordOfferWithV2Shadow(base,{
     env:validEnv,v2Pool:other,
     legacy:async()=>{legacyWrites++;return {recorded:true}},
   }),/ephemeral_database_identity_mismatch/);
   assert.equal(legacyWrites,0);
   for(const table of ['nawaa_offer_v2','nawaa_v2_receipts','nawaa_v2_shadow_outbox','nawaa_v2_backfill_progress']) {
     const q=await other.query('SELECT to_regclass($1) AS t',['public.'+table]);
     assert.equal(q.rows[0].t,null,'unauthorized DB must not contain '+table);
   }
 }finally{await other.end()}
});

test('unverifiable or malformed mock sessions fail closed before writes',async()=>{
 await assert.rejects(attestEphemeralConnection({},{env:validEnv}),/ephemeral_database_connection_unverifiable/);
 await assert.rejects(attestEphemeralConnection({query:async()=>({rows:[]})},{env:validEnv}),/ephemeral_database_identity_mismatch/);
 await assert.rejects(attestEphemeralConnection({query:async()=>{throw new Error('lost_socket')}},{env:validEnv}),/ephemeral_database_attestation_failed/);
 await assert.rejects(attestEphemeralConnection({query:async()=>({rowCount:1,rows:[{
   database_name:'nawaa_ci',database_user:'nawaa',login_user:'nawaa',
   server_address:'198.51.100.20',server_port:5432
 }]})},{env:validEnv}),/ephemeral_database_identity_mismatch/);
});

test('Docker bridge server address is valid only with local pg socket peer',async()=>{
 const identity={rowCount:1,rows:[{
   database_name:'nawaa_ci',database_user:'nawaa',login_user:'nawaa',
   server_address:'172.20.0.3',server_port:5432
 }]};
 await attestEphemeralConnection({query:async()=>identity,connection:{stream:{remoteAddress:'127.0.0.1'}}},{env:validEnv});
 await assert.rejects(attestEphemeralConnection({
   query:async()=>identity,connection:{stream:{remoteAddress:'198.51.100.20'}}
 },{env:validEnv}),/ephemeral_database_identity_mismatch/);
 await assert.rejects(attestEphemeralConnection({
   query:async()=>({rowCount:1,rows:[{...identity.rows[0],server_address:'8.8.8.8'}]})
 },{env:validEnv}),/ephemeral_database_identity_mismatch/);
});
