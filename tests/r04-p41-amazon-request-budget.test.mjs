import test from "node:test";
import assert from "node:assert/strict";
import {amazonBatchBudgetWithinRequest} from "../server/amazon-request-budget.mjs";
import {acquisitionPlan} from "../server/search-cursor.mjs";
test("R04 P41 reserve finalization for twelve-second customer search",()=>{
 assert.equal(amazonBatchBudgetWithinRequest(12000),9000);
 assert.equal(amazonBatchBudgetWithinRequest(25000),10000);
 assert.equal(amazonBatchBudgetWithinRequest(6000),3000);
 assert.equal(amazonBatchBudgetWithinRequest(1000),50);
});
test("R04 P41 preserve source page breadth and 1000 retained results",()=>{
 assert.deepEqual([acquisitionPlan(0).amazonPageStart,acquisitionPlan(0).amazonPageCount],[1,5]);
 assert.deepEqual([acquisitionPlan(1).amazonPageStart,acquisitionPlan(1).amazonPageCount],[6,3]);
 assert.equal(acquisitionPlan(0).resultLimit,1000);
});
test("R04 P41 invalid budgets fail closed",()=>{
 for(const v of [null,0,-1,Infinity,NaN,"oops"])
   assert.throws(()=>amazonBatchBudgetWithinRequest(v),/INVALID_AMAZON_REQUEST_BUDGET/);
 assert.throws(()=>amazonBatchBudgetWithinRequest(12000,{reserveMs:-3}),/INVALID_AMAZON_REQUEST_BUDGET/);
});
