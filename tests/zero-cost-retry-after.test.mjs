import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRetryAfter,retryBudget} from '../server/tooling/retry-after.mjs';
test('honors server throttling and retry ceilings',()=>{
 assert.equal(parseRetryAfter('5'),5000);
 assert.equal(parseRetryAfter('9999999'),3600000);
 assert.equal(parseRetryAfter('invalid'),null);
 assert.equal(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT',Date.parse('Wed, 21 Oct 2015 07:27:00 GMT')),60000);
 assert.deepEqual(retryBudget({status:429,retryAfter:'8'}),{retry:true,delayMs:8000});
 assert.deepEqual(retryBudget({status:403}),{retry:false,delayMs:0});
 assert.deepEqual(retryBudget({status:503,attempts:3}),{retry:false,delayMs:0});
});
