// Ephemeral-only two-price lifecycle proof. The second price is a controlled
// TEST FIXTURE; it does not claim that IKEA has changed the live price.
// Run only against the disposable GitHub Actions PostgreSQL service.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {extractProductDocument} from "../server/url-resolver.mjs";
import {recordOffer,initPersistence,getOfferPriceHistory} from "../server/persistence.mjs";
import {startCertifiedIngestionWorker} from "../server/tooling/certified-ingestion-runtime.mjs";
import {enqueueCertifiedMerchantProduct} from "../server/tooling/merchant-observation-producer.mjs";

const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1"||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"")||
 env.DATABASE_SSL!=="false"||env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"||
 env.NAWAA_ENABLE_CERTIFIED_INGESTION!=="1"||
 !env.NAWAA_INGESTION_SIGNING_KEY||Buffer.byteLength(env.NAWAA_INGESTION_SIGNING_KEY)<32)
 throw new Error("ephemeral_only_price_history_test");
const url="https://www.ikea.com/sa/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s39240787/";
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
let runtime;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(expected){
 const deadline=Date.now()+35000;
 while(Date.now()<deadline){
  const [current,history,receipts]=await Promise.all([
   pool.query("select source_url,sku,product_price,observed_at from nawaa_offers"),
   pool.query("select product_url,price,validation_timestamp from offer_observations order by validation_timestamp,id"),
   pool.query("select ingestion_id from nawaa_ingestion_receipts")
  ]);
  if(current.rowCount===1&&history.rowCount===expected&&receipts.rowCount===expected)
   return {current:current.rows[0],history:history.rows,receipts:receipts.rows};
  await sleep(200);
 }
 throw Error("history_wait_timed_out_at_"+expected);
}
try{
 await initPersistence();
 runtime=await startCertifiedIngestionWorker({env});
 const transmitted=[];
 const boss={send:async (...args)=>{
  const id=await runtime.boss.send(...args);
  transmitted.push({id,payload:args[1]});
  return id;
 }};
 // Stage A: a genuinely fetched page, with real visible DOM price parity,
 // authenticated and written by pg-boss into the disposable database.
 const initial=await enqueueCertifiedMerchantProduct(boss,{
  sourceId:"ikea-sa",url,key:env.NAWAA_INGESTION_SIGNING_KEY
 });
 assert.ok(initial.jobId&&initial.queued,"live_initial_offer_not_queued");
 const first=await waitFor(1);
 const initialPrice=Number(first.current.product_price);
 assert.equal(Number(first.history[0].price),initialPrice);
 assert.equal(first.current.sku.replace(/\D/g,""),"39240787");
 const observedAtInitial=new Date(first.current.observed_at);
 assert.ok(Number.isFinite(initialPrice)&&initialPrice>0);
 // Stage B: simulate a new merchant observation with a changed price; the
 // injected extractor and price-verifier are ONLY permitted inside this
 // isolated CI fixture. The production path still requires real DOM proof.
 const simulatedPrice=Number((initialPrice+10).toFixed(2));
 const originalPage=await extractProductDocument(url);
 const productNode=originalPage.candidates.find(x=>x.strategy==="jsonld")?.product;
 assert.ok(productNode&&productNode.offers&&!Array.isArray(productNode.offers));
 const simulatedDocument={...originalPage,
  candidates:originalPage.candidates.map(x=>x.strategy!=="jsonld"?x:{
   ...x,product:{...x.product,
    offers:{...x.product.offers,price:simulatedPrice}}
  }).filter(x=>x.strategy!=="meta"&&
    !["embedded_json","hydrated_state","storefront_data","domain_adapter"].includes(x.strategy))
 };
 // The fixture contains only a single changed JSON-LD claim; excluding the
 // original corroborating candidates prevents a deliberate contradiction.
 const changed=await enqueueCertifiedMerchantProduct(boss,{
  sourceId:"ikea-sa",url,key:env.NAWAA_INGESTION_SIGNING_KEY,
  extract:async()=>simulatedDocument,
  verifyVisiblePrice:async offer=>({status:"matched",currency:"SAR",price:offer.productPrice})
 });
 assert.ok(changed.queued&&changed.jobId!==initial.jobId,"new_price_should_create_new_job");
 const second=await waitFor(2);
 assert.equal(Number(second.current.product_price),simulatedPrice,"canonical_price_not_updated");
 assert.deepEqual(second.history.map(r=>Number(r.price)),[initialPrice,simulatedPrice],
  "price_history_must_preserve_both_observations");
 assert.equal(second.current.source_url,first.current.source_url);
 assert.ok(new Date(second.current.observed_at)>=observedAtInitial);
 // pg-boss can deliver a receipt twice without appending a price.
 const changedPayload=transmitted.find(x=>x.id===changed.jobId)?.payload;
 assert.ok(changedPayload?.attestation,"signed_second_job_missing");
 const replay=await runtime.handler({id:changed.jobId,data:changedPayload});
 assert.equal(replay.duplicate,true,"signed_queue_redelivery_appended_duplicate");
 const duplicate=await recordOffer({
  sourceUrl:first.current.source_url,title:productNode.name,
  productPrice:simulatedPrice,currency:"SAR",merchant:"IKEA",sourceName:"ikea-sa",
  ingestionId:changed.jobId
 });
 assert.equal(duplicate.duplicate,true,"replayed_ingestion_receipt_not_deduped");
 assert.equal((await pool.query("select count(*)::int as n from offer_observations")).rows[0].n,2);
 // Stage C: an out-of-order older observation must append to history but must
 // NEVER replace the canonical latest price.
 const oldTime=new Date("2020-01-01T00:00:00.000Z");
 const stale=await recordOffer({
  sourceUrl:first.current.source_url,title:productNode.name,
  productPrice:Math.max(1,initialPrice-1),currency:"SAR",
  merchant:"IKEA",sourceName:"ikea-sa",query:"ikea-sa",
  observedAt:oldTime.toISOString(),ingestionId:randomUUID()
 });
 assert.equal(stale.recorded,true);
 const third=await waitFor(3);
 assert.equal(Number(third.current.product_price),simulatedPrice,
  "out_of_order_data_overwrote_canonical_price");
 assert.equal(Number(third.history[0].price),Math.max(1,initialPrice-1));
 assert.equal(third.history[0].validation_timestamp.toISOString(),oldTime.toISOString());
 assert.deepEqual(third.history.slice(1).map(r=>Number(r.price)),[initialPrice,simulatedPrice]);
 const ledger=await getOfferPriceHistory(url,{sourceName:"ikea-sa",limit:10});
 assert.equal(ledger.configured,true);
 assert.equal(ledger.observations.length,3,"historical_read_model_lost_entries");
 assert.deepEqual(ledger.observations.map(x=>x.price),
  [simulatedPrice,initialPrice,Math.max(1,initialPrice-1)],
  "history_must_be_newest_first");
 assert.equal(ledger.observations[0].currency,"SAR");
 assert.equal(ledger.observations[0].healthStatus,"healthy");
 const capped=await getOfferPriceHistory(url,{sourceName:"ikea-sa",limit:2});
 assert.deepEqual(capped.observations.map(x=>x.price),[simulatedPrice,initialPrice]);
 const wrongSource=await getOfferPriceHistory(url,{sourceName:"unrelated-source"});
 assert.equal(wrongSource.observations.length,0,"history_source_isolation_failed");
 await assert.rejects(getOfferPriceHistory(url,{sourceName:"ikea-sa",limit:501}),
  /invalid_price_history_limit/);
 await assert.rejects(getOfferPriceHistory("http://127.0.0.1/",{sourceName:"ikea-sa"}),
  /invalid_price_history_identity/);
 await assert.rejects(pool.query("update offer_observations set price=1"),/append-only/);
 await assert.rejects(pool.query("delete from offer_observations"),/append-only/);
 assert.equal((await pool.query("select count(*)::int as n from offer_observations")).rows[0].n,3);
 console.log(JSON.stringify({
  passed:true,mode:"ephemeral_price_history_controlled_change",
  initialPrice,simulatedPrice,canonicalPrice:Number(third.current.product_price),
  historicalObservations:3,receipts:3,
  replayDeduplicated:true,signedQueueRedeliveryDeduplicated:true,staleCanonicalProtected:true,
  immutableHistory:true,boundedHistoryReadVerified:true,
  isolatedBySource:true,simulatedPriceIsNotRealMerchantEvidence:true
 },null,2));
}finally{
 await runtime?.stop().catch(()=>{});
 await pool.end();
}
