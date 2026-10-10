import test from 'node:test';
import assert from 'node:assert/strict';
import {MerchantBudget} from '../server/tooling/merchant-budget.mjs';
test('work completes and queue returns to idle', async()=>{
 const budget=new MerchantBudget({limit:1});
 const result=await Promise.all([budget.enqueue('shop',()=>1),budget.enqueue('shop',()=>2)]);
 assert.deepEqual(result,[1,2]);
 assert.deepEqual(budget.status('shop'),{active:0,queued:0});
});
