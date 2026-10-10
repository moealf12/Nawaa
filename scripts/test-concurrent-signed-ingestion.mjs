// Concurrency stress test on disposable PostgreSQL ONLY.
// All price amounts are synthetic; never interpreted as actual IKEA observations.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {initPersistence,getOfferPriceHistory} from "../server/persistence.mjs";
import {createOfferIngestionHandler} from "../server/tooling/offer-ingestion-worker.mjs";
import {issueSourceAttestation,createSignedSourceVerifier} from "../server/tooling/source-attestation.mjs";
import {CERTIFIED_SOURCE_HOSTS} from "../src/certified-source-hosts.mjs";

const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1" ||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"") ||
 env.DATABASE_SSL!=="false" || env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1" ||
 typeof env.NAWAA_INGESTION_SIGNING_KEY!=="string" ||
 Buffer.byteLength(env.NAWAA_INGESTION_SIGNING_KEY,"utf8")<32)
 throw new Error("concurrency_test_refuses_non_ephemeral_write");

const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false,max:8});
const sourceId="ikea-sa",key=env.NAWAA_INGESTION_SIGNING_KEY;
const url="https://www.ikea.com/sa/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s39240787/";
const now=Date.now();
const make=(n)=>{
 const offer={title:"Concurrency test fixture - IKEA POANG",sourceUrl:url,
   productPrice:300+n,currency:"SAR",merchant:"IKEA",sku:"392.407.87"};
 const issuedAt=now-14000+n*1000; // all accepted within 15-minute TTL
 return {id:randomUUID(),data:{
  sourceId,verifiedBySource:sourceId,offer,
  attestation:issueSourceAttestation({sourceId,offer,sourceHosts:CERTIFIED_SOURCE_HOSTS,key,clock:()=>issuedAt})
 }};
};
try {
 await initPersistence();
 const worker=createOfferIngestionHandler({
  verify:createSignedSourceVerifier({sourceHosts:CERTIFIED_SOURCE_HOSTS,key,clock:()=>now})
 });
 const jobs=Array.from({length:12},(_,n)=>make(n));
 // Start the most recent observation first; schedule remaining older events concurrently.
 const newest=jobs.at(-1);
 await worker(newest);
 const delayed=[...jobs.slice(0,-1)].reverse();
 // Duplicate the first job 3 times in the same concurrency group.
 const concurrent=[...delayed,delayed[0],delayed[0]];
 const outcomes=await Promise.all(concurrent.map(j=>worker(j)));
 assert.equal(outcomes.filter(x=>x.duplicate).length,2);
 assert.equal(outcomes.filter(x=>x.recorded).length,13);
 const offer=await pool.query("select product_price,observed_at from nawaa_offers");
 assert.equal(offer.rowCount,1);
 assert.equal(Number(offer.rows[0].product_price),311);
 assert.equal(offer.rows[0].observed_at.toISOString(),new Date(now-3000).toISOString());
 const history=await getOfferPriceHistory(url,{sourceName:sourceId,limit:20});
 assert.equal(history.observations.length,12);
 assert.deepEqual(history.observations.map(x=>x.price),Array.from({length:12},(_,i)=>311-i));
 const receipts=await pool.query("select count(*)::int as count from nawaa_ingestion_receipts");
 assert.equal(receipts.rows[0].count,12);
 assert.equal((await worker(newest)).duplicate,true);
 assert.equal((await pool.query("select count(*)::int as count from offer_observations")).rows[0].count,12);
 await assert.rejects(pool.query("delete from offer_observations where price=$1",[300]),/append-only/);
 console.log(JSON.stringify({
  passed:true,mode:"concurrent_authenticated_worker_ephemeral_postgres",
  syntheticPrices:true,uniqueSignedJobs:12,parallelCalls:13,
  simultaneousDuplicateRetries:2,canonicalRows:1,currentPrice:311,
  immutableObservations:12,receipts:12,latePricesDoNotRegress:true,
  historyComplete:true,deleteBlocked:true,productionWrites:false
 },null,2));
}finally{await pool.end();}
