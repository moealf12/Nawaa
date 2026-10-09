import test from "node:test";
import assert from "node:assert/strict";
import {assessPilotProduct,assessPilotHealth} from "../server/tooling/pilot-health-monitor.mjs";
import {PILOT_PRODUCTS} from "../src/ikea-pilot-products.mjs";
const sku=PILOT_PRODUCTS[0].sku,NOW=Date.parse("2026-10-10T12:00:00Z"),H=3600000;
const obs=(price,at)=>({price,currency:"SAR",observedAt:new Date(at).toISOString(),healthStatus:"healthy"});
const history=(...observations)=>({configured:true,observations});
test("no evidence does not assert a real discount",()=>{
 const r=assessPilotProduct({sku,history:history(obs(479,NOW-H)),now:NOW});
 assert.equal(r.status,"fresh");assert.equal(r.priceMove.confirmed,false);
 assert.equal(r.priceMove.status,"insufficient_evidence");
});
test("separate-day verified sample supports bounded sample drop only",()=>{
 const r=assessPilotProduct({sku,history:history(
  obs(479,NOW-H),obs(600,NOW-27*H),obs(620,NOW-51*H)),now:NOW});
 assert.equal(r.priceMove.status,"confirmed_sample_drop");
 assert.equal(r.priceMove.scope,"observed_daily_sample_only");
 assert.equal(r.priceMove.confirmed,true);
 assert.equal(r.alerts.includes("significant_sample_move"),true);
 assert.equal(r.priceMove.percentageVsPreviousDay,-20.17);
});
test("same-day price changes cannot claim multi-day confirmation",()=>{
 const r=assessPilotProduct({sku,history:history(obs(100,NOW-H),obs(140,NOW-3*H)),now:NOW});
 assert.equal(r.priceMove.confirmed,false);assert.equal(r.distinctDays,1);
});
test("mixed price pattern does not qualify as a confirmed sample drop",()=>{
 const r=assessPilotProduct({sku,history:history(obs(90,NOW-H),obs(110,NOW-27*H),obs(80,NOW-51*H)),now:NOW});
 assert.equal(r.priceMove.confirmed,false);
 assert.equal(r.priceMove.status,"no_confirmed_move");
});
test("stale observations show stale display trust",()=>{
 const r=assessPilotProduct({sku,history:history(obs(479,NOW-49*H)),now:NOW});
 assert.equal(r.status,"stale");assert.equal(r.displayTrust,"stale");
 assert.deepEqual(r.alerts,["stale_price"]);
});
test("future, invalid and unhealthy price evidence fail closed",()=>{
 for(const bad of [
  obs(479,NOW+H),{...obs(479,NOW-H),price:-1},
  {...obs(479,NOW-H),healthStatus:"invalid"},
  {...obs(479,NOW-H),currency:"USD"}
 ]){
  const r=assessPilotProduct({sku,history:history(bad),now:NOW});
  assert.equal(r.status,"invalid_observations");
  assert.equal(r.priceMove.confirmed,false);
 }
});
test("unconfigured history remains unknown; no fabricated zero prices",()=>{
 const r=assessPilotProduct({sku,history:{configured:false,observations:[]},now:NOW});
 assert.equal(r.status,"history_unavailable");
 assert.equal(r.priceMove.confirmed,false);
 assert.equal(r.displayTrust,"unverified");
});
test("offline portfolio reports all five without external alerts",()=>{
 const result=assessPilotHealth({histories:{[sku]:history(obs(479,NOW-H))},now:NOW});
 assert.equal(result.totalProducts,5);assert.equal(result.counters.fresh,1);
 assert.equal(result.counters.history_unavailable,4);
 assert.equal(result.productionAlertsSent,0);assert.equal(result.scheduled,false);
});
test("rejects unbounded or malformed evidence and unapproved products",()=>{
 assert.throws(()=>assessPilotProduct({sku:"00000000",history:history(),now:NOW}),/unknown_pilot_sku/);
 assert.throws(()=>assessPilotProduct({sku,history:history(...Array(501).fill(obs(10,NOW-H))),now:NOW}),/unbounded_monitor_history/);
 assert.throws(()=>assessPilotProduct({sku,history:history(),minimumDistinctDays:1,now:NOW}),/invalid_evidence_day_count/);
});
