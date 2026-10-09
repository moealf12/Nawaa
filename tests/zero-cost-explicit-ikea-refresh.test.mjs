import test from "node:test";
import assert from "node:assert/strict";
import {runExplicitIkeaRefresh} from "../server/tooling/explicit-ikea-refresh.mjs";
import {PILOT_PRODUCTS} from "../src/ikea-pilot-products.mjs";
const url=PILOT_PRODUCTS[0].url,now=Date.parse("2026-10-10T12:00:00.000Z");
const key="unit-test-key-for-explicit-refresh-32-character-minimum";
const env={
 NAWAA_ENABLE_EXPLICIT_MERCHANT_REFRESH:"1",
 NAWAA_ENABLE_BACKGROUND_JOBS:"1",NAWAA_ENABLE_CERTIFIED_INGESTION:"1",
 NAWAA_ENABLE_REFRESH_BUDGET:"1",NAWAA_INGESTION_SIGNING_KEY:key
};
const budget={windowStartedAt:now-3600000,requestsUsed:0};
function context(overrides={}){
 const events=[];
 const inputs={
  url,boss:{send:async()=>null},key,env,clock:()=>now,
  readHistory:async()=>{events.push("history");return {configured:true,observations:[]}},
  readBudget:async()=>{events.push("budget");return budget},
  reserveBudget:async(source,sku)=>{events.push("reserve");assert.equal(source,"ikea-sa");assert.equal(sku,"39240787");return {admitted:true}},
  publish:async(boss,options)=>{
   events.push("publish");return {queued:true,jobId:"signed-job"}
  },
  ...overrides
 };
 return {events,inputs};
}
test("manual refresh refuses missing explicit enablement or other URLs",async()=>{
 let count=0;
 const {inputs}=context({readHistory:async()=>{count++;return {configured:true,observations:[]}}});
 await assert.rejects(runExplicitIkeaRefresh({...inputs,env:{...env,NAWAA_ENABLE_EXPLICIT_MERCHANT_REFRESH:"0"}}),/explicit_merchant_refresh_disabled/);
 await assert.rejects(runExplicitIkeaRefresh({...inputs,url:"https://www.ikea.com/sa/en/p/fake-12345678/"}),/not_an_approved_refresh_pilot_product/);
 await assert.rejects(runExplicitIkeaRefresh({...inputs,key:"wrong"}),/refresh_signing_key_mismatch/);
 assert.equal(count,0);
});
test("fresh prices skip reservation, HTTP extraction and publication",async()=>{
 const {events,inputs}=context({
  readHistory:async()=>({configured:true,observations:[{observedAt:new Date(now-3600000).toISOString()}]})
 });
 const result=await runExplicitIkeaRefresh(inputs);
 assert.equal(result.queued,false);
 assert.equal(result.reason,"not_due_yet");
 assert.ok(!events.includes("reserve"));
 assert.ok(!events.includes("publish"));
});
test("admission reserves source budget before calling the signed producer",async()=>{
 const {events,inputs}=context({
  publish:async(boss,opts)=>{
   events.push("publish");
   assert.equal(opts.sourceId,"ikea-sa");
   assert.equal(opts.url,url);
   assert.equal(typeof opts.extract,"function");
   assert.equal(typeof opts.verifyVisiblePrice,"function");
   return {queued:true,jobId:"signed-job",evidence:{visiblePriceProof:"matched"}};
  }
 });
 const result=await runExplicitIkeaRefresh(inputs);
 assert.deepEqual(events.slice(0,2).sort(),["budget","history"]);
 assert.deepEqual(events.slice(2),["reserve","publish"]);
 assert.equal(result.queued,true);
 assert.equal(result.chargedRequests,2);
});
test("a concurrent quota denial stops before producer network operations",async()=>{
 const {events,inputs}=context({
  reserveBudget:async()=>{events.push("reserve");return {admitted:false,reason:"daily_request_budget_exhausted"};}
 });
 const result=await runExplicitIkeaRefresh(inputs);
 assert.equal(result.queued,false);
 assert.equal(result.reason,"daily_request_budget_exhausted");
 assert.ok(!events.includes("publish"));
});
test("depleted read-only quota prevents a reservation call",async()=>{
 const {events,inputs}=context({readBudget:async()=>({windowStartedAt:budget.windowStartedAt,requestsUsed:10})});
 const result=await runExplicitIkeaRefresh(inputs);
 assert.equal(result.queued,false);
 assert.equal(result.reason,"request_budget_exhausted");
 assert.ok(!events.includes("reserve"));
});
test("missing history cannot silently authorize a crawl",async()=>{
 const {events,inputs}=context({readHistory:async()=>({configured:false,observations:[]})});
 await assert.rejects(runExplicitIkeaRefresh(inputs),/refresh_history_unavailable/);
 assert.ok(!events.includes("reserve"));
});
