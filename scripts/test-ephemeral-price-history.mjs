// Deterministic price-change lifecycle: disposable CI database ONLY.
// A price decrease, a stale late-arriving observation, and an idempotent retry.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {recordOffer,getOfferPriceHistory,initPersistence} from "../server/persistence.mjs";

const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1"||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"")||
 env.DATABASE_SSL!=="false"||env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1")
 throw Error("refusing_non_ephemeral_price_lifecycle_write");

const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
// Isolated synthetic fixture: do not alter the five live IKEA offers in this database.
const url="https://fixture.example.test/ci/price-lifecycle-99999999";
const sourceName="ci-price-history";
const first="2026-10-08T12:00:00.000Z",second="2026-10-09T12:00:00.000Z";
const stale="2026-10-07T12:00:00.000Z";
const base={title:"CI price history fixture",
 sourceUrl:url,sourceName,query:sourceName,merchant:"CI fixture",
 currency:"SAR",sku:"99999999"};
try{
 await initPersistence();
 const id1=randomUUID(),id2=randomUUID(),id3=randomUUID();
 const a=await recordOffer({...base,productPrice:479,observedAt:first,ingestionId:id1});
 assert.equal(a.recorded,true);
 assert.equal(a.canonicalUpdated,true);
 const b=await recordOffer({...base,productPrice:449,observedAt:second,ingestionId:id2});
 assert.equal(b.recorded,true);
 assert.equal(b.canonicalUpdated,true);
 const duplicate=await recordOffer({...base,productPrice:449,observedAt:second,ingestionId:id2});
 assert.equal(duplicate.duplicate,true);
 // An older observation may be appended but MUST NOT roll the canonical latest price back.
 const outOfOrder=await recordOffer({...base,productPrice:999,observedAt:stale,ingestionId:id3});
 assert.equal(outOfOrder.recorded,true);
 assert.equal(outOfOrder.canonicalUpdated,false);
 const canonical=await pool.query("select product_price,observed_at,sku from nawaa_offers");
 const fixtureRows=canonical.rows.filter(x=>x.sku==="99999999");
 assert.equal(fixtureRows.length,1);
 assert.equal(Number(fixtureRows[0].product_price),449);
 assert.equal(fixtureRows[0].observed_at.toISOString(),second);
 const history=await getOfferPriceHistory(url,{sourceName,limit:10});
 assert.equal(history.observations.length,3);
 assert.deepEqual(history.observations.map(x=>x.price),[449,479,999]);
 assert.deepEqual(history.observations.map(x=>x.observedAt),[second,first,stale]);
 const receipts=await pool.query("select count(*)::int as total from nawaa_ingestion_receipts");
 assert.ok(receipts.rows[0].total>=3);
 await assert.rejects(pool.query("delete from offer_observations"),/append-only/);
 const after=await getOfferPriceHistory(url,{sourceName,limit:10});
 assert.equal(after.observations.length,3);
 console.log(JSON.stringify({success:true,mode:"deterministic_ephemeral_price_change",
  canonicalPrice:449,historicalPrices:history.observations.map(x=>x.price),
  observations:3,receipts:3,duplicateIgnored:true,staleCannotOverwriteLatest:true,
  historicalMutationsRejected:true},null,2));
}finally{
 await pool.end();
}
