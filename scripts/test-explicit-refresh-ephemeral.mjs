// One explicitly admitted, two-GET IKEA refresh with a disposable CI database.
// Never run against production; no scheduling, no public search impact.
import assert from "node:assert/strict";
import pg from "pg";
import {PILOT_PRODUCTS} from "../src/ikea-pilot-products.mjs";
import {initPersistence,getOfferPriceHistory} from "../server/persistence.mjs";
import {startCertifiedIngestionWorker} from "../server/tooling/certified-ingestion-runtime.mjs";
import {runExplicitIkeaRefresh} from "../server/tooling/explicit-ikea-refresh.mjs";
import {getDurableRefreshBudget,closeDurableRefreshBudget} from "../server/tooling/durable-refresh-budget.mjs";
const env=process.env;
if(env.NAWAA_CI_EPHEMERAL_DB!=="1"||
 !/^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/.test(env.DATABASE_URL||"")||
 env.DATABASE_SSL!=="false"||env.NAWAA_ENABLE_BACKGROUND_JOBS!=="1"||
 env.NAWAA_ENABLE_CERTIFIED_INGESTION!=="1"||
 env.NAWAA_ENABLE_REFRESH_BUDGET!=="1"||
 env.NAWAA_ENABLE_EXPLICIT_MERCHANT_REFRESH!=="1"||
 typeof env.NAWAA_INGESTION_SIGNING_KEY!=="string"||
 env.NAWAA_INGESTION_SIGNING_KEY.length<32)
 throw new Error("refusing_non_ephemeral_explicit_refresh");
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:false});
const url=PILOT_PRODUCTS[0].url,key=env.NAWAA_INGESTION_SIGNING_KEY;
let runtime;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 await initPersistence();
 runtime=await startCertifiedIngestionWorker({env});
 const first=await runExplicitIkeaRefresh({url,boss:runtime.boss,key});
 assert.equal(first.admitted,true);
 assert.equal(first.queued,true);
 assert.equal(first.chargedRequests,2);
 assert.equal(first.evidence.visiblePriceProof,"matched");
 let historic;
 const deadline=Date.now()+40000;
 while(Date.now()<deadline){
  historic=await getOfferPriceHistory(url,{sourceName:"ikea-sa",limit:10});
  if(historic.observations.length===1)break;
  await delay(250);
 }
 assert.equal(historic.observations.length,1);
 const second=await runExplicitIkeaRefresh({url,boss:runtime.boss,key});
 assert.equal(second.admitted,false);
 assert.equal(second.reason,"not_due_yet");
 assert.equal(second.queued,false);
 const budget=await getDurableRefreshBudget("ikea-sa");
 assert.equal(budget.requestsUsed,2);
 const offers=await pool.query("select sku,product_price from nawaa_offers");
 const receipts=await pool.query("select count(*)::int as n from nawaa_ingestion_receipts");
 assert.equal(offers.rowCount,1);
 assert.equal(offers.rows[0].sku.replace(/\D/g,""),PILOT_PRODUCTS[0].sku);
 assert.equal(Number(offers.rows[0].product_price),historic.observations[0].price);
 assert.equal(receipts.rows[0].n,1);
 console.log(JSON.stringify({passed:true,mode:"one_explicit_refresh_two_get_budget",
  realMerchantPriceObserved:historic.observations[0].price,
  officialSku:PILOT_PRODUCTS[0].sku,merchantPriceParity:"matched",
  quotaRequestsUsed:2,canonicalRows:1,historyRows:1,receipts:1,
  immediateRepeatBlocked:true,productionWrites:false,noScheduler:true},null,2));
}finally{
 await runtime?.stop().catch(()=>{});
 await closeDurableRefreshBudget();
 await pool.end();
}
