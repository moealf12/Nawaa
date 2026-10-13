import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEphemeralPool,initV2} from '../../server/persistence-v2.mjs';
import {initPersistence} from '../../server/persistence.mjs';
import {backfillV2Snapshots} from '../../server/persistence-v2-backfill.mjs';
const pool=createEphemeralPool();
await initPersistence(); await initV2(pool);
test.after(async()=>pool.end());
test('cold backfill bootstrap serializes concurrent PostgreSQL DDL',async()=>{
 const existing=(await pool.query("SELECT to_regclass('public.nawaa_v2_backfill_progress') AS rel")).rows[0].rel;
 assert.equal(existing,null,'ephemeral test starts before progress-table initialization');
 const blocker=await pool.connect();
 const jobs=[];
 try{
   await blocker.query('BEGIN');
   await blocker.query('SELECT pg_advisory_xact_lock($1,$2)',[17032,1]);
   jobs.push(backfillV2Snapshots(pool,{stopAfter:0}));
   jobs.push(backfillV2Snapshots(pool,{stopAfter:0}));
   let waiters=0;
   const deadline=Date.now()+2500;
   while(Date.now()<deadline && waiters<2){
     const result=await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname=current_database() AND wait_event_type='Lock' AND wait_event='advisory'`);
     waiters=result.rows[0].n;
     if(waiters<2)await new Promise(resolve=>setTimeout(resolve,25));
   }
   assert.equal(waiters,2,'both concurrent initializers must wait on the same DDL advisory lock');
   assert.equal((await pool.query("SELECT to_regclass('public.nawaa_v2_backfill_progress') AS rel")).rows[0].rel,null);
 }finally{
   try{await blocker.query('ROLLBACK')}finally{blocker.release()}
 }
 await Promise.all(jobs);
 assert.equal((await pool.query("SELECT to_regclass('public.nawaa_v2_backfill_progress') IS NOT NULL AS present")).rows[0].present,true);
});

test('two backfill workers serialize each legacy snapshot and preserve variants',async()=>{
 const name=randomUUID();
 for(const variant of ['128','256']){
   await pool.query(`INSERT INTO nawaa_offers(offer_key,source_url,title,sku,condition,currency,product_price,observed_at,payload)
    VALUES($1,$2,'Backfill race', $3,'new','SAR',$4,'2026-10-10T12:00:00Z',$5::jsonb)`,[
    name+'-'+variant,'https://www.jarir.com/sa/race/'+name,variant,variant==='128'?100:200,
    JSON.stringify({sourceId:'jarir-sa',sourceListingId:name,sourceVariantId:variant})
   ]);
 }
 await Promise.all([backfillV2Snapshots(pool,{batchSize:1}),backfillV2Snapshots(pool,{batchSize:1})]);
 const rows=await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2 WHERE source_id=$1 AND offer_key IN (SELECT offer_key FROM nawaa_offer_v2 WHERE source_url=$2)', ['jarir-sa','https://jarir.com/sa/race/'+name]);
 assert.equal(rows.rows[0].n,2);
 const results=await pool.query('SELECT product_price FROM nawaa_offer_v2 WHERE source_url=$1 ORDER BY product_price',['https://jarir.com/sa/race/'+name]);
 assert.deepEqual(results.rows.map(x=>Number(x.product_price)),[100,200]);
 const again=await backfillV2Snapshots(pool,{batchSize:1});
 assert.equal(again.copied,0);
});
test('rollback between V2 observation and progress marker never commits half a snapshot',async()=>{
 const name=randomUUID(),url='https://www.jarir.com/sa/race/'+name;
 const inserted=await pool.query(`INSERT INTO nawaa_offers(offer_key,source_url,title,sku,condition,currency,product_price,observed_at,payload)
 VALUES($1,$2,'Backfill failure','128','new','SAR',888,'2026-10-10T12:00:00Z',$3::jsonb) RETURNING id`,[
 name,url,JSON.stringify({sourceId:'jarir-sa',sourceListingId:name,sourceVariantId:'128'})]);
 const id=inserted.rows[0].id;
 await pool.query(`CREATE OR REPLACE FUNCTION nawaa_ci_backfill_abort() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.legacy_id=$1 THEN RAISE EXCEPTION 'ci_backfill_marker_failure'; END IF; RETURN NEW; END; $$`.replace('NEW.legacy_id=$1','NEW.legacy_id='+Number(id)));
 await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_backfill_abort ON nawaa_v2_backfill_progress');
 await pool.query('CREATE TRIGGER nawaa_ci_backfill_abort BEFORE INSERT ON nawaa_v2_backfill_progress FOR EACH ROW EXECUTE FUNCTION nawaa_ci_backfill_abort()');
 try{
   await assert.rejects(backfillV2Snapshots(pool,{batchSize:1}),/ci_backfill_marker_failure/);
   const count=(await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2 WHERE offer_key IN (SELECT offer_key FROM nawaa_offer_v2 WHERE source_url=$1)',['https://jarir.com/sa/race/'+name])).rows[0].n;
   assert.equal(count,0);
 }finally{await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_backfill_abort ON nawaa_v2_backfill_progress')}
 const recovered=await backfillV2Snapshots(pool,{batchSize:10});
 assert.ok(recovered.copied>=1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_backfill_progress WHERE legacy_id=$1',[id])).rows[0].n,1);
});
