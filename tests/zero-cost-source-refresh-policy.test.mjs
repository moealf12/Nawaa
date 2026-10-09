import test from "node:test";
import assert from "node:assert/strict";
import {IKEA_REFRESH_POLICY,planIkeaRefresh,priceFreshnessStatus} from "../server/tooling/source-refresh-policy.mjs";
const NOW=Date.parse("2026-10-10T12:00:00.000Z"),H=3600000;
const item=(sku)=>({sku,url:"https://www.ikea.com/sa/en/p/test-product-"+sku+"/"});
const catalog=["39240787","30213076","40104294","80504563","70358492"].map(item);
const budget=(requestsUsed=0,windowStartedAt=NOW-2*H)=>({requestsUsed,windowStartedAt});
const plan=(overrides={})=>planIkeaRefresh({products:catalog,budget:budget(),now:NOW,...overrides});
test("five IKEA products cost ten merchant requests, no auto scheduling",()=>{
 const result=plan();
 assert.equal(result.planned.length,5);
 assert.equal(result.estimatedRequests,10);
 assert.equal(result.quota.remainingAfterPlan,0);
 assert.equal(result.schedulingEnabled,false);
 assert.equal(result.productionEnforcementReady,false);
});
test("strict freshness thresholds determine eligibility and honest display trust",()=>{
 assert.equal(priceFreshnessStatus(NOW-5*H,{now:NOW}).status,"fresh");
 assert.equal(priceFreshnessStatus(NOW-6*H,{now:NOW}).status,"aging");
 const stale=priceFreshnessStatus(NOW-48*H,{now:NOW});
 assert.equal(stale.status,"stale");
 assert.equal(stale.displayTrust,"stale");
 assert.equal(priceFreshnessStatus(null,{now:NOW}).status,"unknown");
 assert.equal(priceFreshnessStatus(NOW+100000,{now:NOW}).status,"invalid");
});
test("fresh or cooling products are skipped without spending requests",()=>{
 const observations={
 "39240787":{lastSuccessfulAt:NOW-2*H},
 "30213076":{consecutiveFailures:1,lastAttemptAt:NOW-10*60000,lastSuccessfulAt:NOW-49*H},
 "40104294":{lastHttpStatus:429,retryAfterUntil:NOW+H},
 "80504563":{lastHttpStatus:403}
 };
 const result=plan({observations});
 assert.deepEqual(result.planned.map(x=>x.sku),["70358492"]);
 const reasons=Object.fromEntries(result.entries.map(x=>[x.sku,x.reason]));
 assert.equal(reasons["39240787"],"not_due_yet");
 assert.equal(reasons["30213076"],"failure_backoff");
 assert.equal(reasons["40104294"],"merchant_retry_after_cooldown");
 assert.equal(reasons["80504563"],"manual_review_http_status");
});
test("daily budget limits planned products and expires safely",()=>{
 assert.equal(plan({budget:budget(8)}).planned.length,1);
 const no=plan({budget:budget(10)});
 assert.equal(no.planned.length,0);
 assert.equal(no.entries[0].reason,"request_budget_exhausted");
 const expired=plan({budget:budget(10,NOW-25*H)});
 assert.equal(expired.planned.length,5);
 assert.equal(expired.quota.requestsUsed,0);
});
test("stale products first, highest age wins, unknown is prioritized",()=>{
 const observations={
 "39240787":{lastSuccessfulAt:NOW-10*H},
 "30213076":{lastSuccessfulAt:NOW-60*H},
 "40104294":{lastSuccessfulAt:NOW-25*H},
 "80504563":{lastSuccessfulAt:NOW-8*H},
 "70358492":{lastSuccessfulAt:NOW-7*H}
 };
 assert.equal(plan({observations,budget:budget(8)}).planned[0].sku,"30213076");
});
test("three failures quarantine source until manual review",()=>{
 const r=plan({observations:{"39240787":{consecutiveFailures:3}}});
 assert.equal(r.entries[0].reason,"manual_review_failure_limit");
});
test("untrusted URLs, duplicate SKUs, clocks and absent quota fail closed",()=>{
 assert.throws(()=>plan({budget:null}),/refresh_budget_snapshot_required/);
 assert.throws(()=>plan({products:[catalog[0],catalog[0]]}),/duplicate_refresh_product/);
 assert.throws(()=>plan({products:[{sku:"39240787",url:"https://ikea.com.attacker.com/sa/en/p/x-39240787/"}]}),/unapproved_refresh_product_url/);
 assert.throws(()=>plan({products:[item("39240788").url?{sku:"39240788",url:catalog[0].url}:catalog[0]]}),/refresh_product_sku_mismatch/);
 assert.throws(()=>plan({budget:budget(-1)}),/invalid_refresh_budget_snapshot/);
 assert.throws(()=>plan({now:NaN}),/invalid_refresh_clock/);
 assert.throws(()=>plan({observations:{"39240787":{lastSuccessfulAt:NOW+60000}}}),/invalid_refresh_state_time/);
});

test("accepts millisecond-level reservation race without allowing arbitrarily future windows",()=>{
 const near=plan({budget:budget(2,NOW+250)});
 assert.equal(near.quota.requestsUsed,2);
 assert.equal(near.planned.length,4);
 assert.throws(()=>plan({budget:budget(2,NOW+60000)}),/invalid_refresh_budget_snapshot/);
});
