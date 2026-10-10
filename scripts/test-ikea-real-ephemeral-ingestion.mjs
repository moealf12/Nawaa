// One-shot live merchant → HMAC → pg-boss → ACID PostgreSQL proof.
// DO NOT run against production; refuses anything except disposable localhost CI DB.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {startCertifiedIngestionWorker} from "../server/tooling/certified-ingestion-runtime.mjs";
import {enqueueCertifiedMerchantProduct} from "../server/tooling/merchant-observation-producer.mjs";
import {initPersistence} from "../server/persistence.mjs";
import {PILOT_PRODUCTS} from "./probe-ikea-batch.mjs";

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
 const completed=[];
 for(const input of PILOT_PRODUCTS){
  let payload;
  const boss={send:async (...args)=>{payload=args[1];return running.boss.send(...args);}};
  const queued=await enqueueCertifiedMerchantProduct(boss,{sourceId,url:input.url,key:env.NAWAA_INGESTION_SIGNING_KEY});
  assert.equal(queued.queued,true);
  assert.equal(payload.offer.sku.replace(/\D/g,""),input.sku);
  completed.push({input,jobId:queued.jobId,payload});
  await new Promise(r=>setTimeout(r,650));
 }
 const deadline=Date.now()+45000;
 let result;
 while(Date.now()<deadline){
  const [offers,observations,receipts]=await Promise.all([
   pool.query("select source_url,sku,product_price,currency,image_url from nawaa_offers"),
   pool.query("select product_url,price,currency from offer_observations"),
   pool.query("select ingestion_id from nawaa_ingestion_receipts")]);
  if(offers.rowCount===5&&observations.rowCount===5&&receipts.rowCount===5){result={offers:offers.rows,observations:observations.rows,receipts:receipts.rows};break;}
  await new Promise(r=>setTimeout(r,250));
 }
 assert.ok(result,"five_product_ingestion_timeout");
 for(const item of completed){
  const offer=result.offers.find(x=>x.sku?.replace(/\D/g,"")===item.input.sku);
  assert.ok(offer,"missing_canonical_offer");
  assert.equal(Number(offer.product_price),item.payload.offer.productPrice);
  assert.equal(offer.currency,"SAR");
  assert.equal(offer.image_url,item.payload.offer.imageUrl);
  assert.equal(result.observations.filter(x=>x.product_url===offer.source_url).length,1);
  assert.ok(result.receipts.some(x=>x.ingestion_id===item.jobId));
  const replay=await running.handler({id:item.jobId,data:item.payload});
  assert.equal(replay.duplicate,true);
 }
 await assert.rejects(running.handler({id:randomUUID(),data:{...completed[0].payload,offer:{...completed[0].payload.offer,productPrice:1}}}),/trusted_source_verifier_required/);
 const after=await pool.query("select count(*)::int as n from offer_observations");
 assert.equal(after.rows[0].n,5);
 await assert.rejects(pool.query("update offer_observations set price=1"),/append-only/);
 console.log(JSON.stringify({success:true,mode:"five_live_products_ephemeral_postgresql",offers:5,observations:5,receipts:5,duplicateReplaysRejected:5,forgedPriceRejected:true,prices:completed.map(x=>({sku:x.input.sku,price:x.payload.offer.productPrice}))},null,2));
}finally{
 await running?.stop().catch(()=>{});
 await pool.end();
}
