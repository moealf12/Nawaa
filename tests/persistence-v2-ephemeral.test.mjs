import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEphemeralPool,initV2,recordOfferV2} from '../server/persistence-v2.mjs';
const pool=createEphemeralPool();
const base={sourceId:'jarir-sa',sourceUrl:'https://www.jarir.com/sa/p/15',sourceListingId:'15',sourceVariantId:'128',condition:'new',productPrice:1000,currency:'SAR',observedAt:'2026-10-10T10:00:00Z'};
await initV2(pool);
test.after(async()=>pool.end());
const offer=(suffix,fields={})=>({...base,sourceListingId:suffix,sourceUrl:'https://www.jarir.com/sa/p/'+suffix,...fields});
test('same job replay and simultaneous duplicates are idempotent',async()=>{
 const a=offer('replay'),id=randomUUID();
 const results=await Promise.all(Array.from({length:6},()=>recordOfferV2(pool,a,{ingestionId:id})));
 assert.equal(results.filter(x=>!x.duplicate).length,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_observation_v2 WHERE offer_key=$1',[results[0].offerKey])).rows[0].n,1);
 await assert.rejects(recordOfferV2(pool,{...a,productPrice:2},{ingestionId:id}),/ingestion_id_payload_conflict/);
});
test('older arrivals are stored but cannot replace newer price',async()=>{
 const newer=offer('ordering',{productPrice:1200,observedAt:'2026-10-10T12:00:00Z'});
 const older={...newer,productPrice:900,observedAt:'2026-10-10T09:00:00Z'};
 const first=await recordOfferV2(pool,newer,{ingestionId:randomUUID()});
 await recordOfferV2(pool,older,{ingestionId:randomUUID()});
 const row=(await pool.query('SELECT product_price FROM nawaa_offer_v2 WHERE offer_key=$1',[first.offerKey])).rows[0];
 assert.equal(Number(row.product_price),1200);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_observation_v2 WHERE offer_key=$1',[first.offerKey])).rows[0].n,2);
});
test('mid-transaction failure rolls back receipt and observation and canonical',async()=>{
 const id=randomUUID(),a=offer('rollback');
 await assert.rejects(recordOfferV2(pool,a,{ingestionId:id,failAfterObservation:true}),/injected_mid_transaction_failure/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_v2_receipts WHERE ingestion_id=$1',[id])).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_observation_v2 WHERE ingestion_id=$1',[id])).rows[0].n,0);
 const outcome=await recordOfferV2(pool,a,{ingestionId:id});assert.equal(outcome.duplicate,false);
});
test('variants on same URL do not collide',async()=>{
 const a=offer('variant',{sourceVariantId:'128',productPrice:1000});
 const b={...a,sourceVariantId:'256',productPrice:1250};
 const x=await recordOfferV2(pool,a,{ingestionId:randomUUID()});
 const y=await recordOfferV2(pool,b,{ingestionId:randomUUID()});
 assert.notEqual(x.offerKey,y.offerKey);
 const rows=await pool.query('SELECT count(*)::int AS n FROM nawaa_offer_v2 WHERE offer_key=ANY($1)',[[x.offerKey,y.offerKey]]);
 assert.equal(rows.rows[0].n,2);
});
test('equal timestamps preserve first canonical snapshot but append history',async()=>{
 const a=offer('equal',{productPrice:1000});
 const b={...a,productPrice:1100};
 const x=await recordOfferV2(pool,a,{ingestionId:randomUUID()});
 await recordOfferV2(pool,b,{ingestionId:randomUUID()});
 assert.equal(Number((await pool.query('SELECT product_price FROM nawaa_offer_v2 WHERE offer_key=$1',[x.offerKey])).rows[0].product_price),1000);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_observation_v2 WHERE offer_key=$1',[x.offerKey])).rows[0].n,2);
});
test('immutable history cannot be modified',async()=>{
 await assert.rejects(pool.query('DELETE FROM nawaa_observation_v2'),/v2_observations_immutable/);
});
