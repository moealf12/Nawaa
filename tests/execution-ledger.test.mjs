import test from "node:test";
import assert from "node:assert/strict";
import {loadExecutionLedger,validateExecutionLedger,EXPECTED_PACKAGES} from "../scripts/verify-execution-ledger.mjs";
const original=loadExecutionLedger();
const negative=(mutate,part)=>{
  // Test invalid transitions from a controlled initial state. The real ledger
  // changes from IN_PROGRESS to VERIFIED; negative controls must not drift
  // or silently turn into valid transitions when a round is completed.
  const plan=structuredClone(original);
  plan.rounds[0].status="IN_PROGRESS";
  plan.rounds[0].evidence={};
  mutate(plan);
  const errors=validateExecutionLedger(plan);
  assert.ok(errors.some(s=>s.includes(part)),JSON.stringify(errors));
};
test("21 rounds and 35 packages are uniquely accounted for",()=>{
  assert.deepEqual(validateExecutionLedger(original),[]);
  assert.equal(EXPECTED_PACKAGES.length,35);
  assert.equal(original.rounds.flatMap(x=>x.packages).length,35);
});
test("reject missing round",()=>negative(x=>x.rounds.pop(),"expected exactly 21"));
test("reject duplicate ownership",()=>negative(x=>x.rounds[1].packages.push("E00"),"duplicate E00"));
test("reject unassigned work",()=>negative(x=>x.rounds[0].packages=x.rounds[0].packages.filter(p=>p!=="S00"),"unassigned S00"));
test("reject round reordering",()=>negative(x=>{[x.rounds[0],x.rounds[1]]=[x.rounds[1],x.rounds[0]];},"round ID/order mismatch"));
test("reject round advancement without prior verification",()=>negative(x=>{x.rounds[1].status="IN_PROGRESS";x.rounds[1].baseSha=original.initialMainSha;},"previous round not VERIFIED"));
test("reject multiple rounds in progress",()=>negative(x=>{x.rounds[1].status="IN_PROGRESS";x.rounds[1].baseSha=original.initialMainSha;},"multiple IN_PROGRESS"));
test("reject invented completed status with missing evidence",()=>negative(x=>x.rounds[0].status="VERIFIED","PR evidence missing"));
test("reject blocked status without a reason",()=>negative(x=>x.rounds[0].status="BLOCKED","missing documented blocker"));
test("reject a planned round with an asserted baseline",()=>negative(x=>x.rounds[2].baseSha=original.initialMainSha,"planned rounds must not claim baseline"));
test("JSON serialization leaves all invariants intact",()=>assert.deepEqual(validateExecutionLedger(JSON.parse(JSON.stringify(original))),[]));
