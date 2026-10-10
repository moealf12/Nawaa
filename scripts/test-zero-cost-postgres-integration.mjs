// Isolated PostgreSQL + pg-boss integration; executed against GitHub Actions
// service container only. Never points at an actual NAWAA production database.
import assert from "node:assert/strict";
import pg from "pg";
import {randomUUID} from "node:crypto";
import {createBackgroundBoss} from "../server/tooling/background-boss.mjs";
import {recordOffer,initPersistence} from "../server/persistence.mjs";
import {
  OFFER_INGESTION_QUEUE,createOfferIngestionHandler,
  enqueueVerifiedOffer,registerOfferIngestionWorker,
} from "../server/tooling/offer-ingestion-worker.mjs";
import {createSignedSourceVerifier,issueSourceAttestation} from "../server/tooling/source-attestation.mjs";

if(process.env.NAWAA_CI_EPHEMERAL_DB!=="1"
   ||!/^postgres(?:ql)?:\/\/[^/]+@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(process.env.DATABASE_URL||""))
 throw new Error("refusing_non_ephemeral_database");
if(process.env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"||process.env.DATABASE_SSL!=="false")
 throw new Error("ephemeral_environment_invalid");

const sourceId="ikea-sa";
const sourceHosts={"ikea-sa":["ikea.com"]};
const key="this-secret-is-for-ephemeral-ci-only-not-production-987654321";
const offer={
  title:"Test-only IKEA chair fixture",sourceUrl:"https://www.ikea.com/sa/en/p/test-fixture-12345678/",
  productPrice:399,currency:"SAR",merchant:"IKEA",
  image:"https://www.ikea.com/assets/test-fixture.jpg",
};
const verify=createSignedSourceVerifier({sourceHosts,key});
const attestation=issueSourceAttestation({sourceId,offer,sourceHosts,key});
const payload={sourceId,offer,query:"chair",verifiedBySource:sourceId,attestation};
const boss=createBackgroundBoss(), pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});
let resolveProcessed,rejectProcessed;
const processed=new Promise((resolve,reject)=>{resolveProcessed=resolve;rejectProcessed=reject;});
const handler=createOfferIngestionHandler({verify});
let success=false;
try{
 await initPersistence();
 await boss.start();
 await boss.createQueue(OFFER_INGESTION_QUEUE,{retryLimit:2,retryDelay:1});
 await registerOfferIngestionWorker(boss,{teamSize:1,handler:async job=>{
   try{resolveProcessed(await handler(job));}
   catch(e){rejectProcessed(e);throw e;}
 }});
 const jobId=await enqueueVerifiedOffer(boss,payload);
 assert.match(jobId,/^[0-9a-f-]{36}$/i);
 const duplicateJob=await enqueueVerifiedOffer(boss,payload);
 assert.equal(duplicateJob,null,"singleton dedup should suppress burst duplicate");
 const observed=await Promise.race([
   processed,new Promise((_,reject)=>setTimeout(()=>reject(new Error("worker_timeout")),35000))
 ]);
 assert.equal(observed.recorded,true);
 const dbBefore=await pool.query("select count(*)::int AS n from offer_observations");
 assert.equal(dbBefore.rows[0].n,1);
 const row=await pool.query("select product_price,image_url,currency from nawaa_offers");
 assert.equal(row.rows.length,1);
 assert.equal(Number(row.rows[0].product_price),399);
 assert.equal(row.rows[0].image_url,offer.image);
 assert.equal(row.rows[0].currency,"SAR");
 const replay=await handler({id:jobId,data:payload});
 assert.equal(replay.recorded,true);
 assert.equal(replay.duplicate,true,"retry must ACK without duplicating observation");
 const dbAfter=await pool.query("select count(*)::int AS n from offer_observations");
 assert.equal(dbAfter.rows[0].n,1);
 await assert.rejects(
   handler({id:randomUUID(),data:{...payload,offer:{...offer,productPrice:1}}}),
   /trusted_source_verifier_required/
 );
 await assert.rejects(
   pool.query("update offer_observations set price=1"),
   /append-only/
 );
 const receipts=await pool.query("select count(*)::int AS n from nawaa_ingestion_receipts");
 assert.equal(receipts.rows[0].n,1);
 console.log(JSON.stringify({ok:true,pgboss:true,immutable:true,duplicateSuppressed:true,
   persistedOffers:row.rows.length,offerObservations:dbAfter.rows[0].n,receipts:receipts.rows[0].n}));
 success=true;
}finally{
 await boss.stop().catch(()=>{});
 await pool.end();
}
if(!success)process.exitCode=1;
