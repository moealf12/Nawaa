// Signed worker → recordOffer: replay and out-of-order delivery on disposable CI PostgreSQL.
// All prices are synthetic fixtures, not actual merchant price observations.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {initPersistence,getOfferPriceHistory} from "../server/persistence.mjs";
import {createOfferIngestionHandler} from "../server/tooling/offer-ingestion-worker.mjs";
import {issueSourceAttestation,createSignedSourceVerifier} from "../server/tooling/source-attestation.mjs";
import {CERTIFIED_SOURCE_HOSTS} from "../src/certified-source-hosts.mjs";

const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1"||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"")||
 env.DATABASE_SSL!=="false"||env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"||
 typeof env.NAWAA_INGESTION_SIGNING_KEY!=="string"||
 Buffer.byteLength(env.NAWAA_INGESTION_SIGNING_KEY,"utf8")<32)
 throw new Error("disposable_postgresql_only");
const url="https://www.ikea.com/sa/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s39240787/";
const key=env.NAWAA_INGESTION_SIGNING_KEY,sourceId="ikea-sa";
const now=Date.now();
const slots=[now-9000,now-6000,now-3000];
const prices=[479,449,429];
const makeJob=(index)=>{
 const offer={title:"CI synthetic IKEA price sequence",sourceUrl:url,
  productPrice:prices[index],currency:"SAR",merchant:"IKEA",sku:"392.407.87"};
 const attestation=issueSourceAttestation({sourceId,offer,sourceHosts:CERTIFIED_SOURCE_HOSTS,
  key,clock:()=>slots[index]});
 return {id:randomUUID(),data:{sourceId,verifiedBySource:sourceId,offer,attestation}};
};
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
try{
 await initPersistence();
 const jobs=[0,1,2].map(makeJob);
 const handler=createOfferIngestionHandler({
  verify:createSignedSourceVerifier({sourceHosts:CERTIFIED_SOURCE_HOSTS,key,clock:()=>now})
 });
 // Deliver newest FIRST, followed by older signed observations.
 for(const index of [2,0,1]){
  const result=await handler(jobs[index]);
  assert.equal(result.recorded,true);
 }
 const offers=await pool.query("select product_price,observed_at from nawaa_offers");
 assert.equal(offers.rowCount,1);
 assert.equal(Number(offers.rows[0].product_price),429);
 assert.equal(offers.rows[0].observed_at.toISOString(),new Date(slots[2]).toISOString());
 const history=await getOfferPriceHistory(url,{sourceName:sourceId,limit:10});
 assert.deepEqual(history.observations.map(row=>row.price),[429,449,479]);
 assert.deepEqual(history.observations.map(row=>row.observedAt),slots.toReversed().map(t=>new Date(t).toISOString()));
 const receipts=await pool.query("select count(*)::int as n from nawaa_ingestion_receipts");
 assert.equal(receipts.rows[0].n,3);
 const duplicate=await handler(jobs[0]);
 assert.equal(duplicate.duplicate,true);
 const tampered={...jobs[1],id:randomUUID(),data:{
  ...jobs[1].data,offer:{...jobs[1].data.offer,productPrice:1}
 }};
 await assert.rejects(handler(tampered),/trusted_source_verifier_required/);
 const after=await pool.query("select count(*)::int as n from offer_observations");
 assert.equal(after.rows[0].n,3);
 console.log(JSON.stringify({passed:true,syntheticFixture:true,
  workerUsesSignedTimestamp:true,newestFirstDelivery:true,
  currentPrice:429,historicalPrices:history.observations.map(x=>x.price),
  historyRows:3,receipts:3,replayDeduplicated:true,tamperingRejected:true,
  productionWrites:false},null,2));
}finally{await pool.end();}
