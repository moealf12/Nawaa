// Disposable PostgreSQL-only historical price update + out-of-order arrival proof.
// Price changes below are synthetic test fixtures, NOT observations from IKEA.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {initPersistence,recordOffer,getOfferPriceHistory} from "../server/persistence.mjs";

const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1"||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"")||
 env.DATABASE_SSL!=="false"||env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1")
 throw new Error("refusing_non_ephemeral_history_write");
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
const url="https://www.ikea.com/sa/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s39240787/";
const base={sourceUrl:url,title:"POANG armchair synthetic price lifecycle",merchant:"IKEA",sourceName:"ikea-sa",
 sku:"392.407.87",currency:"SAR",query:"ikea-sa"};
const first=randomUUID(),second=randomUUID(),lateArrival=randomUUID();
try{
 await initPersistence();
 const before=await recordOffer({...base,productPrice:479,observedAt:"2026-10-09T10:00:00Z",ingestionId:first});
 assert.equal(before.canonicalUpdated,true);
 const current=await recordOffer({...base,productPrice:429,observedAt:"2026-10-09T12:00:00Z",ingestionId:second});
 assert.equal(current.canonicalUpdated,true);
 // A delayed earlier observation arrives after the newer one: preserve both,
 // but NEVER roll back the current product price.
 const delayed=await recordOffer({...base,productPrice:499,observedAt:"2026-10-09T11:00:00Z",ingestionId:lateArrival});
 assert.equal(delayed.canonicalUpdated,false);
 const replay=await recordOffer({...base,productPrice:429,observedAt:"2026-10-09T12:00:00Z",ingestionId:second});
 assert.equal(replay.duplicate,true);
 const currentRow=await pool.query("select product_price,observed_at from nawaa_offers");
 assert.equal(currentRow.rowCount,1,"canonical_should_have_one_offer");
 assert.equal(Number(currentRow.rows[0].product_price),429,"stale_arrival_overwrote_latest_price");
 assert.equal(new Date(currentRow.rows[0].observed_at).toISOString(),"2026-10-09T12:00:00.000Z");
 const history=await getOfferPriceHistory(url,{sourceName:"ikea-sa",limit:10});
 assert.equal(history.observations.length,3);
 assert.deepEqual(history.observations.map(x=>x.price),[429,499,479]);
 assert.ok(history.observations.every(x=>x.currency==="SAR"));
 const receipts=await pool.query("select ingestion_id from nawaa_ingestion_receipts");
 assert.equal(receipts.rowCount,3);
 const mutation=pool.query("update offer_observations set price=1");
 await assert.rejects(mutation,/append-only/);
 const after=await getOfferPriceHistory(url,{sourceName:"ikea-sa",limit:10});
 assert.deepEqual(after.observations.map(x=>x.price),[429,499,479]);
 const bounded=await getOfferPriceHistory(url,{sourceName:"ikea-sa",limit:2});
 assert.deepEqual(bounded.observations.map(x=>x.price),[429,499]);
 console.log(JSON.stringify({success:true,environment:"ephemeral_postgresql_only",
  pricesSynthetic:true,canonicalLatest:429,historyNewestFirst:[429,499,479],
  canonicalRows:1,immutableObservations:3,ingestionReceipts:3,
  olderArrivalDidNotRegressLatest:true,duplicateRetryRejected:true,mutationRejected:true},null,2));
}finally{
 await pool.end();
}
