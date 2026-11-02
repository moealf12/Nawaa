import test from "node:test";
import assert from "node:assert/strict";
import {compareR04DomOrder} from "../scripts/r04-dom-parity-contract.mjs";

const valid={expectedKeys:["q-one","q-two","q-three"],domKeys:["q-one","q-two","q-three"],
  recoveryRequests:0,streamDone:true};

test("R04 DOM same-SSE full ordered group match passes",()=>{
  assert.deepEqual(compareR04DomOrder(valid).failures,[]);
  assert.equal(compareR04DomOrder(valid).pass,true);
});
test("R04 DOM order swapped must fail, even when counts match",()=>{
  const x=compareR04DomOrder({...valid,domKeys:["q-two","q-one","q-three"]});
  assert.equal(x.pass,false);
  assert.ok(x.failures.includes("DOM_GROUP_ORDER_MISMATCH"));
});
test("R04 DOM omitted and duplicated groups fail",()=>{
  for(const domKeys of [["q-one"],["q-one","q-one","q-three"]]){
    assert.equal(compareR04DomOrder({...valid,domKeys}).pass,false);
  }
});
test("R04 independent JSON recovery never masquerades as same-session SSE parity",()=>{
  const x=compareR04DomOrder({...valid,recoveryRequests:1});
  assert.ok(x.failures.includes("RECOVERY_NOT_SAME_SNAPSHOT"));
});
test("R04 DOM missing final SSE done is UNKNOWN not PASS",()=>{
  assert.ok(compareR04DomOrder({...valid,streamDone:false}).failures.includes("SSE_NOT_DONE"));
});
test("R04 DOM empty group lists and malformed counters fail closed",()=>{
  for(const candidate of [
    {...valid,domKeys:[]},
    {...valid,expectedKeys:[]},
    {...valid,recoveryRequests:null},
    {...valid,recoveryRequests:-1},
  ])assert.equal(compareR04DomOrder(candidate).pass,false);
});
