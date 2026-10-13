import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool,initV2} from '../../server/persistence-v2.mjs';
import {initPersistence} from '../../server/persistence.mjs';
import {backfillV2Snapshots} from '../../server/persistence-v2-backfill.mjs';
const pool=createEphemeralPool();
await initPersistence();
await initV2(pool);
test.after(async()=>pool.end());
test('backfill resumes without duplicate observations and quarantines unknown variants',async()=>{
 const unique='phase0-'+Date.now();
 const rows=[
   {id:unique+'-128',variant:'128',price:200},
   {id:unique+'-256',variant:'256',price:300},
   {id:unique+'-unknown',variant:null,price:400},
 ];
 for(const r of rows) {
   await pool.query(`INSERT INTO nawaa_offers(offer_key,source_url,title,merchant,sku,condition,currency,product_price,observed_at,payload)
   VALUES($1,$2,$3,$4,$5,'new','SAR',$6,'2026-10-10T12:00:00Z',$7::jsonb)`,[
    'legacy-'+r.id,'https://www.jarir.com/sa/'+unique,'Fixture product','Jarir',r.variant,
    r.price,JSON.stringify({sourceId:'jarir-sa',sourceListingId:unique,...(r.variant?{sourceVariantId:r.variant}:{})})
   ]);
 }
 const first=await backfillV2Snapshots(pool,{batchSize:2});
 assert.equal(first.copied,2);
 assert.equal(first.unresolved,1);
 const before=(await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2')).rows[0].n;
 const again=await backfillV2Snapshots(pool,{batchSize:2});
 assert.equal(again.copied,0);
 assert.equal(again.unresolved,0);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_observation_v2')).rows[0].n,before);
 const variants=await pool.query("SELECT product_price FROM nawaa_offer_v2 WHERE source_url=$1 ORDER BY product_price",['https://jarir.com/sa/'+unique]);
 assert.deepEqual(variants.rows.map(r=>Number(r.product_price)),[200,300]);
 const legacy=await pool.query('SELECT count(*)::int n FROM nawaa_offers WHERE offer_key LIKE $1',['legacy-'+unique+'%']);
 assert.equal(legacy.rows[0].n,3);
});
