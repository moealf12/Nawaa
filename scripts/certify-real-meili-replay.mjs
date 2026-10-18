// Real temporary Meilisearch instance, two actual Node processes + Docker
// restart between phases. All prices/stock changes are adversarial SIMULATIONS
// using merchant-grounded Jarir SKU/title/chassis identity from 2026-10-18.
// ZERO outbound merchant requests; NO production index or credentials.
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {MeiliSearch} from "meilisearch";
import {indexOffers,searchIndexedOffers,INDEXED_OFFER_FRESH_MS} from "../server/search-index.mjs";
import {assessOfferMatch} from "../src/search-query.mjs";

const stage=process.argv[2]||"";
const stateFile=".meili-restart-fixture-state.json";
assert.ok(["write","read"].includes(stage),"stage is write or read");
assert.equal(process.env.NODE_ENV,"test","must run as explicit test only");
assert.equal(process.env.MEILI_HOST,"http://127.0.0.1:7700","localhost-only Meili guard");
assert.equal(process.env.MEILI_INDEX,"nawaa_ci_replay","isolated index only");
const sdk=new MeiliSearch({host:process.env.MEILI_HOST,apiKey:process.env.MEILI_MASTER_KEY});
const db=sdk.index(process.env.MEILI_INDEX);
const base="https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-";
const game={sourceUrl:base+"670688.html",
  title:"Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with Fornite Flowering Chaos, White",
  merchant:"Jarir",merchantCountryCode:"SA",currency:"SAR",productPrice:2299,
  availability:"in_stock",condition:"new",exactMatch:true,matchConfidence:1,
  sourceMeta:{productId:"670688"},specs:{brand:"Sony",modelNumber:"CFI2116AFNTVC"}};
const controller={sourceUrl:base+"677770.html",
  title:"Sony PlayStation 5 Slim Console Blu-ray Edition, 1 TB, Bundle with DualSense Wireless Controller, White",
  merchant:"Jarir",merchantCountryCode:"SA",currency:"SAR",productPrice:3049,
  availability:"unknown",condition:"new",exactMatch:true,matchConfidence:1,
  sourceMeta:{productId:"677770"},specs:{brand:"Sony",modelNumber:"CFI2116ACFIZC"}};
const docs=async()=> (await db.getDocuments({limit:40})).results || [];
async function waitFor(check,label,timeoutMs=12000){
 const start=Date.now();
 while(Date.now()-start<timeoutMs){
   try{const rows=await docs();if(check(rows))return rows}catch(error){
     if(Date.now()-start>timeoutMs-1000)throw error;
   }
   await new Promise(resolve=>setTimeout(resolve,250));
 }
 throw Error("Meilisearch task did not materialize: "+label);
}
if(stage==="write"){
 const old=new Date(Date.now()-8*3600000).toISOString();
 const recent=new Date(Date.now()-1000).toISOString();
 const result=await indexOffers([{...game,observedAt:old},{...controller,observedAt:recent}]);
 assert.equal(result.indexed,2);
 const visible=await waitFor(rows=>rows.length===2&&
   rows.some(x=>x.sourceMeta?.productId==="670688")&&
   rows.some(x=>x.sourceMeta?.productId==="677770"),"initial products");
 assert.equal(visible.find(x=>x.sourceMeta.productId==="670688").observedAt,old);
 assert.equal(visible.find(x=>x.sourceMeta.productId==="677770").observedAt,recent);
 await writeFile(stateFile,JSON.stringify({old,recent}),"utf8");
 console.log("REAL_MEILI_STAGE "+JSON.stringify({stage,pid:process.pid,documents:visible.length,
   historicalObservationPreserved:true,skuDistinct:true,mpnDistinct:true,
   sourceCalls:0,service:"real-docker"}));
}else{
 const saved=JSON.parse(await readFile(stateFile,"utf8"));
 const before=await waitFor(rows=>rows.length===2,"restored rows");
 const old=before.find(x=>x.sourceMeta?.productId==="670688");
 const recent=before.find(x=>x.sourceMeta?.productId==="677770");
 assert.ok(old&&recent);
 assert.equal(old.observedAt,saved.old,"restart must not retimestamp old retailer data");
 assert.equal(recent.observedAt,saved.recent);
 assert.equal(old.specs?.modelNumber,"CFI2116AFNTVC");
 assert.equal(recent.specs?.modelNumber,"CFI2116ACFIZC");
 const indexed=await searchIndexedOffers("PlayStation 5 Slim");
 assert.equal(indexed.offers.length,1,"only fresh retail observation can reach shopper");
 assert.equal(indexed.offers[0].sourceMeta.productId,"677770");
 assert.equal(indexed.offers[0].availability,"unknown");
 assert.equal(indexed.offers[0].exactMatch,false,"historical exact must reset");
 assert.equal(assessOfferMatch("PS5 DualSense Bundle",indexed.offers[0]).exactMatch,true);
 const expired=await searchIndexedOffers("PlayStation",{now:Date.now()+INDEXED_OFFER_FRESH_MS+10000});
 assert.equal(expired.offers.length,0,"old stock cannot be made fresh by index restart");
 // Adversarial delayed earlier worker after a simulated (not real merchant)
 // newer out-of-stock price update. A direct indexed upsert is asynchronous,
 // so explicitly await each materialized write before the next.
 const newObservedAt=new Date().toISOString();
 await indexOffers([{...controller,observedAt:newObservedAt,productPrice:3099,availability:"out_of_stock"}]);
 await waitFor(rows=>rows.find(x=>x.sourceMeta?.productId==="677770")?.productPrice===3099,
   "newest priced observation");
 await indexOffers([{...controller,observedAt:saved.recent,productPrice:3049,availability:"unknown"}]);
 const after=await waitFor(rows=>rows.find(x=>x.sourceMeta?.productId==="677770")?.productPrice===3049,
   "delayed older overwrite");
 assert.equal(after.find(x=>x.sourceMeta?.productId==="677770").productPrice,3099,
   "older observation must never overwrite new indexed price and stock");
 console.log("REAL_MEILI_STAGE "+JSON.stringify({stage,pid:process.pid,restarted:true,
   durableRows:before.length,oldRejected:true,freshPreserved:true,
   queryReclassified:true,oldExactReset:true,newerObservationGuard:true}));
}
