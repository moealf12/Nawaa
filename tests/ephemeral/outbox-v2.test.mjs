import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEphemeralPool,initV2} from '../../server/persistence-v2.mjs';
import {initPersistence} from '../../server/persistence.mjs';
import {initShadowOutbox,commitLegacyAndOutbox,processShadowOutbox} from '../../server/persistence-v2-outbox.mjs';
const pool=createEphemeralPool();
await initPersistence();await initV2(pool);await initShadowOutbox(pool);
test.after(async()=>pool.end());
const base=id=>({legacyOfferKey:'outbox-'+id,sourceId:'jarir-sa',sourceUrl:'https://www.jarir.com/sa/p/'+id,
 sourceListingId:id,sourceVariantId:'128',title:'CI Shadow fixture',productPrice:100,currency:'SAR',
 condition:'new',observedAt:'2026-10-10T12:00:00Z'});
test('atomic legacy snapshot and outbox; retry produces one event',async()=>{
 const a=base(randomUUID()),id=randomUUID();
 const first=await commitLegacyAndOutbox(pool,a,{eventId:id});
 assert.equal(first.duplicate,false);
 const duplicate=await commitLegacyAndOutbox(pool,a,{eventId:id});
 assert.equal(duplicate.duplicate,true);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id])).rows[0].n,1);
 const events=await processShadowOutbox(pool);
 assert.ok(events.some(x=>x.id===id&&x.status==='completed'));
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2 WHERE ingestion_id=$1',[id])).rows[0].n,1);
 await assert.rejects(commitLegacyAndOutbox(pool,{...a,productPrice:20},{eventId:id}),/event_id_payload_conflict/);
});
test('two consumers claim each available event once',async()=>{
 const ids=Array.from({length:6},()=>randomUUID());
 for(const id of ids)await commitLegacyAndOutbox(pool,base(id),{eventId:id});
 const all=(await Promise.all([processShadowOutbox(pool,{max:3}),processShadowOutbox(pool,{max:3})])).flat();
 assert.equal(new Set(all.map(x=>x.id)).size,6);
 assert.equal(all.filter(x=>x.status==='completed').length,6);
});
test('failures retry then become dead; original legacy row stays',async()=>{
 const a=base(randomUUID()),id=randomUUID();
 await commitLegacyAndOutbox(pool,a,{eventId:id});
 const worker=async()=>{throw new Error('synthetic_failure')};
 for(let i=0;i<3;i++){
  await processShadowOutbox(pool,{worker,now:new Date(Date.now()+i*20000)});
 }
 const row=(await pool.query('SELECT status,attempts FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id])).rows[0];
 assert.equal(row.status,'dead');assert.equal(row.attempts,3);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_offers WHERE offer_key=$1',[a.legacyOfferKey])).rows[0].n,1);
});
test('unresolved variant cannot create outbox or legacy row',async()=>{
 const a={...base(randomUUID()),sourceVariantId:null};const id=randomUUID();
 await assert.rejects(commitLegacyAndOutbox(pool,a,{eventId:id}),/missing_variant_disambiguator/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id])).rows[0].n,0);
});


test('active claim holds an atomic lock so a newer worker cannot reclaim during V2 write',async()=>{
 const id=randomUUID(),a=base(randomUUID());
 await commitLegacyAndOutbox(pool,a,{eventId:id});
 let releaseOld,signalOld;
 const started=new Promise(resolve=>{signalOld=resolve;});
 const blocked=new Promise(resolve=>{releaseOld=resolve;});
 const early=new Date('2026-10-11T00:00:00Z');
 await pool.query('UPDATE nawaa_v2_shadow_outbox SET next_attempt_at=$2 WHERE event_id=$1',[id,early]);
 const oldRun=processShadowOutbox(pool,{max:1,now:early,worker:async()=>{signalOld();await blocked;}});
 await started;
 // Despite lease expiry in the synthetic clock, SKIP LOCKED cannot steal the
 // event while the original worker holds the SQL transaction/row lock.
 const concurrent=await processShadowOutbox(pool,{max:1,now:new Date('2026-10-11T00:02:00Z')});
 assert.deepEqual(concurrent,[]);
 releaseOld();
 assert.deepEqual(await oldRun,[{id,status:'completed'}]);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_attempts WHERE event_id=$1',[id])).rows[0].n,1);
});
test('expired lease remains pending after process restart and can be claimed anew',async()=>{
 const id=randomUUID(),a=base(randomUUID());
 await commitLegacyAndOutbox(pool,a,{eventId:id});
 await pool.query(`UPDATE nawaa_v2_shadow_outbox SET status='processing',claim_token=$2,attempts=1,lease_until=$3 WHERE event_id=$1`,
   [id,randomUUID(),new Date('2026-10-10T01:00:00Z')]);
 const result=await processShadowOutbox(pool,{max:1});
 assert.equal(result[0].status,'completed');
 assert.equal((await pool.query('SELECT attempts FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id])).rows[0].attempts,2);
});


test('simultaneous same-ID legacy writers converge without rejected duplicates',async()=>{
 const eventId=randomUUID(),offer=base(randomUUID());
 const outcomes=await Promise.all(Array.from({length:8},()=>commitLegacyAndOutbox(pool,offer,{eventId})));
 assert.equal(outcomes.filter(x=>x.duplicate===false).length,1);
 assert.equal(outcomes.filter(x=>x.duplicate===true).length,7);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[eventId])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_offers WHERE offer_key=$1',[offer.legacyOfferKey])).rows[0].n,1);
 await assert.rejects(commitLegacyAndOutbox(pool,{...offer,productPrice:999},{eventId}),/event_id_payload_conflict/);
});


test('audit INSERT failure rolls back V2 and resumes after lease expiry',async()=>{
 const id=randomUUID(),a=base(randomUUID());
 await commitLegacyAndOutbox(pool,a,{eventId:id});
 await pool.query(`CREATE OR REPLACE FUNCTION nawaa_ci_fail_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'ci_attempt_audit_abort'; END; $$`);
 await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_fail_attempt ON nawaa_v2_shadow_attempts');
 await pool.query('CREATE TRIGGER nawaa_ci_fail_attempt BEFORE INSERT ON nawaa_v2_shadow_attempts FOR EACH ROW EXECUTE FUNCTION nawaa_ci_fail_attempt()');
 try{
  await assert.rejects(processShadowOutbox(pool,{max:100}),/ci_attempt_audit_abort/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2 WHERE ingestion_id=$1',[id])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_receipts WHERE ingestion_id=$1',[id])).rows[0].n,0);
 }finally{
  await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_fail_attempt ON nawaa_v2_shadow_attempts');
 }
 const restored=await processShadowOutbox(pool,{max:100,now:new Date(Date.now()+120000)});
 assert.ok(restored.some(x=>x.id===id&&x.status==='completed'));
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2 WHERE ingestion_id=$1',[id])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_attempts WHERE event_id=$1',[id])).rows[0].n,1);
});


test('repeated worker crashes exhaust bounded retries and create one durable dead audit',async()=>{
 const id=randomUUID(),a=base(randomUUID());
 await commitLegacyAndOutbox(pool,a,{eventId:id});
 const expired=new Date(Date.now()-120000);
 const token=randomUUID();
 await pool.query(`UPDATE nawaa_v2_shadow_outbox
   SET status='processing',attempts=max_attempts,claim_token=$2,lease_until=$3
   WHERE event_id=$1`,[id,token,expired]);
 const outcomes=await Promise.all([
  processShadowOutbox(pool,{max:100}),
  processShadowOutbox(pool,{max:100})
 ]);
 assert.equal(outcomes.flat().filter(x=>x.id===id).length,0);
 const state=await pool.query('SELECT status,attempts,claim_token FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id]);
 assert.equal(state.rows[0].status,'dead');
 assert.equal(state.rows[0].claim_token,null);
 const audit=await pool.query('SELECT outcome,error FROM nawaa_v2_shadow_attempts WHERE event_id=$1',[id]);
 assert.equal(audit.rowCount,1);
 assert.equal(audit.rows[0].outcome,'dead');
 assert.equal(audit.rows[0].error,'lease_expired_retry_budget_exhausted');
 await processShadowOutbox(pool,{max:100,now:new Date(Date.now()+360000)});
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_attempts WHERE event_id=$1',[id])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2 WHERE ingestion_id=$1',[id])).rows[0].n,0);
});
