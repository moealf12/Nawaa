import test from "node:test";
import assert from "node:assert/strict";
import {assessRequiredPrReadiness,REQUIRED_PR_JOBS} from "../scripts/verify-required-pr-gate.mjs";
const sha="a".repeat(40);
const baseline=()=>({event:"pull_request",baseRef:"main",sha,checkoutSha:sha,needs:Object.fromEntries(REQUIRED_PR_JOBS.map(k=>[k,{result:"success"}]))});
const check=fn=>{const x=baseline();fn(x);return assessRequiredPrReadiness(x);};
test("required PR aggregator only accepts success on exact head",()=>{
 assert.deepEqual(assessRequiredPrReadiness(baseline()),{allowed:true,sha});
});
for(const job of REQUIRED_PR_JOBS)for(const status of ["failure","cancelled","skipped","pending",null]){
 test("fail closed "+job+"="+status,()=>{
  const d=check(x=>{x.needs[job]=status===null?null:{result:status};});
  assert.equal(d.allowed,false);assert.ok(d.blocked.includes(job));
 });
}
test("missing job rejected",()=>assert.equal(check(x=>delete x.needs["nawaa-pr-integrations"]).allowed,false));
test("missing needs rejected",()=>assert.equal(check(x=>x.needs=null).allowed,false));
test("outdated head rejected",()=>assert.equal(check(x=>x.checkoutSha="b".repeat(40)).reason,"wrong-head"));
test("invalid head rejected",()=>assert.equal(check(x=>x.sha="main").allowed,false));
test("different base and event rejected",()=>{
 assert.equal(check(x=>x.baseRef="develop").allowed,false);
 assert.equal(check(x=>x.event="push").allowed,false);
});
