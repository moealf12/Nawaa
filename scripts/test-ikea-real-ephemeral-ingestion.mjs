// One-shot live merchant → HMAC → pg-boss → ACID PostgreSQL proof.
// DO NOT run against production; refuses anything except disposable localhost CI DB.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {startCertifiedIngestionWorker} from "../server/tooling/certified-ingestion-runtime.mjs";
import {enqueueCertifiedMerchantProduct} from "../server/tooling/merchant-observation-producer.mjs";
import {initPersistence} from "../server/persistence.mjs";

const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1"||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"")||
 env.DATABASE_SSL!=="false"||
 env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"||
 env.NAWAA_ENABLE_CERTIFIED_INGESTION!=="1"||
 typeof env.NAWAA_INGESTION_SIGNING_KEY!=="string"||
 env.NAWAA_INGESTION_SIGNING_KEY.length<32)
 throw new Error("refusing_non_ephemeral_write");
const sourceId="ikea-sa";
const url="https://www.ikea.com/sa/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s39240787/";
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
let running;
try{
 await initPersistence();
 running=await startCertifiedIngestionWorker({env});
 let captured=null;
 const trackedBoss={send:async (...args)=>{
  if(captured!==null)throw new Error("only_one_queue_submission_permitted");
  captured=args[1];return running.boss.send(...args);
 }};
 const {jobId,queued,evidence}=await enqueueCertifiedMerchantProduct(trackedBoss,{
  sourceId,url,key:env.NAWAA_INGESTION_SIGNING_KEY
 });
 assert.equal(queued,true);
 assert.match(jobId,/^[0-9a-f-]{36}$/i);
 assert.equal(evidence.merchantPriceVerified,true);
 assert.equal(captured.sourceId,sourceId);
 assert.equal(captured.verifiedBySource,sourceId);
 assert.match(captured.attestation,/^v1\.\d{13}\.[a-f0-9]{64}$/);
 assert.equal(captured.offer.currency,"SAR");
 assert.equal(captured.offer.sku.replace(/\D/g,""),"39240787");
 const timeoutAt=Date.now()+35000;
 let found=null;
 while(Date.now()<timeoutAt){
  const receipts=await pool.query("select ingestion_id from nawaa_ingestion_receipts where ingestion_id=$1",[jobId]);
  const row=await pool.query("select offer_key,source_url,title,product_price,currency,image_url,sku,merchant from nawaa_offers");
  const observations=await pool.query("select product_url,source_name,price,currency from offer_observations");
  if(receipts.rows.length===1&&row.rows.length===1&&observations.rows.length===1){
   found={receipt:receipts.rows[0],offer:row.rows[0],observation:observations.rows[0]};
   break;
  }
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 assert.ok(found,"live_offer_ingestion_timeout");
 assert.equal(Number(found.offer.product_price),captured.offer.productPrice);
 assert.equal(Number(found.observation.price),captured.offer.productPrice);
 assert.equal(found.offer.currency,"SAR");
 assert.equal(found.observation.currency,"SAR");
 assert.equal(found.observation.source_name,sourceId);
 assert.equal(found.offer.merchant,"IKEA");
 assert.equal(found.offer.sku.replace(/\D/g,""),"39240787");
 assert.ok(found.offer.image_url?.startsWith("https://www.ikea.com/sa/en/images/products/"),"merchant_image_missing");
 const replay=await running.handler({id:jobId,data:captured});
 assert.equal(replay.duplicate,true);
 const obsAfterReplay=await pool.query("select count(*)::int as n from offer_observations");
 assert.equal(obsAfterReplay.rows[0].n,1,"replay_appended_observation");
 await assert.rejects(running.handler({
  id:randomUUID(),data:{...captured,offer:{...captured.offer,productPrice:1}}
 }),/trusted_source_verifier_required/);
 const obsAfterTampering=await pool.query("select count(*)::int as n from offer_observations");
 assert.equal(obsAfterTampering.rows[0].n,1);
 await assert.rejects(pool.query("update offer_observations set price=1"),/append-only/);
 console.log(JSON.stringify({success:true,mode:"one_shot_ephemeral_postgresql",
  merchant:sourceId,sku:found.offer.sku,price:Number(found.offer.product_price),
  currency:found.offer.currency,imageUrl:found.offer.image_url,
  pgBoss:true,hmac:true,immutable:true,replayIdempotent:true,
  observations:obsAfterReplay.rows[0].n,receipts:1},null,2));
}finally{
 await running?.stop().catch(()=>{});
 await pool.end();
}
