import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createEphemeralPool,initV2} from '../../server/persistence-v2.mjs';
import {initPersistence} from '../../server/persistence.mjs';
import {backfillV2Snapshots} from '../../server/persistence-v2-backfill.mjs';
const pool=createEphemeralPool();
await initPersistence();await initV2(pool);
test.after(async()=>pool.end());

test('backfill rereads changed legacy price after its initial candidate selection',async()=>{
 const listing=randomUUID(),url='https://jarir.com/sa/fresh/'+listing;
 const inserted=await pool.query(`INSERT INTO nawaa_offers(offer_key,title,source_url,sku,condition,currency,product_price,observed_at,payload)
 VALUES($1,'Fresh price test',$2,'128','new','SAR',100,'2026-10-10T11:00:00Z',$3::jsonb)
 RETURNING id`,['fresh-'+listing,url,JSON.stringify({sourceId:'jarir-sa',sourceListingId:listing,sourceVariantId:'128'})]);
 const legacyId=inserted.rows[0].id;
 const owner=await pool.connect();
 let migration;
 try{
  await owner.query('SELECT pg_advisory_lock($1,$2)',[17031,Number(legacyId)%2147483647]);
  migration=backfillV2Snapshots(pool,{batchSize:100});
  let waiting=false;
  for(let i=0;i<100;i++){
   const check=await pool.query("SELECT count(*)::int n FROM pg_locks WHERE locktype='advisory' AND NOT granted");
   if(check.rows[0].n>0){waiting=true;break;}
   await pause(20);
  }
  assert.equal(waiting,true,'backfill never waited for its transaction lock');
  await pool.query("UPDATE nawaa_offers SET product_price=220, observed_at='2026-10-10T12:00:00Z' WHERE id=$1",[legacyId]);
 }finally{
  await owner.query('SELECT pg_advisory_unlock($1,$2)',[17031,Number(legacyId)%2147483647]);
  owner.release();
 }
 await migration;
 const rows=await pool.query('SELECT product_price,observed_at FROM nawaa_offer_v2 WHERE source_url=$1',[url]);
 assert.equal(rows.rowCount,1);
 assert.equal(Number(rows.rows[0].product_price),220);
 assert.equal(new Date(rows.rows[0].observed_at).toISOString(),'2026-10-10T12:00:00.000Z');
});
