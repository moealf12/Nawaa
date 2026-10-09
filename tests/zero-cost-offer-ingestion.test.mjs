import test from "node:test";
import assert from "node:assert/strict";
import {OFFER_INGESTION_QUEUE,createOfferIngestionHandler,enqueueVerifiedOffer,registerOfferIngestionWorker} from "../server/tooling/offer-ingestion-worker.mjs";
const offer={title:"HP Pavilion 15 Laptop",sourceUrl:"https://example.com/item/15",productPrice:2100,currency:"SAR",merchant:"Verified Store"};
test("background ingestion records verified positive-price offers through ACID persistence hook",async()=>{
 let recorded=null;
 const handler=createOfferIngestionHandler({record:async offer=>{recorded=offer;return {recorded:true,observationId:10};}});
 const outcome=await handler({data:{sourceId:"ikea-sa",verifiedBySource:"ikea-sa",offer}});
 assert.equal(outcome.observationId,10);assert.equal(recorded.sourceName,"ikea-sa");assert.equal(recorded.productPrice,2100);
});
test("background ingestion rejects unverified or malformed offers before persistence",async()=>{
 let called=0;
 const handler=createOfferIngestionHandler({record:async()=>{called++;return {recorded:true};}});
 const base={sourceId:"ikea-sa",verifiedBySource:"ikea-sa",offer};
 for(const bad of [{...base,verifiedBySource:"unknown"},{...base,offer:{...offer,productPrice:0}},{...base,offer:{...offer,sourceUrl:"http://example.com/item"}},{...base,offer:{...offer,merchant:undefined}},{...base,sourceId:"../../etc"}]){
  await assert.rejects(handler({data:bad}));
 }
 assert.equal(called,0);
});
test("producer refuses unverified data and sends only validated payloads",async()=>{
 const calls=[];const boss={send:async(...args)=>{calls.push(args);return "job-123";}};
 await assert.rejects(enqueueVerifiedOffer(boss,{sourceId:"ikea-sa",verifiedBySource:"bad",offer}),/verification_required/);
 const jobId=await enqueueVerifiedOffer(boss,{sourceId:"ikea-sa",verifiedBySource:"ikea-sa",offer,query:"chair"});
 assert.equal(jobId,"job-123");assert.equal(calls[0][0],OFFER_INGESTION_QUEUE);
});
test("worker registers explicit bounded concurrency only, without starting database",async()=>{
 let name,opts,fn;
 await registerOfferIngestionWorker({work:async (...args)=>{[name,opts,fn]=args;}},{handler:async()=>{},teamSize:2});
 assert.equal(name,OFFER_INGESTION_QUEUE);assert.equal(opts.teamSize,2);
 assert.equal(typeof fn,"function");
 await assert.rejects(registerOfferIngestionWorker({work:()=>{}},{teamSize:100}),/invalid_team_size/);
});
