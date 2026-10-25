import test from 'node:test';
import assert from 'node:assert/strict';
import {requireLiveRevision} from '../scripts/live-sha-guard.mjs';

const main='1164e7d1e2fd78eec31a50045ba06976f9edc874';
const stale='13222f3562747a24f31d1d3bb98ca4891f83c7d7';

test('v21.84 postdeployment guard admits only exact main revision',()=>{
 assert.equal(requireLiveRevision(main,main),true);
 assert.equal(requireLiveRevision(main.toUpperCase(),main),true);
});
test('v21.84 negative control fails for stale production, not just bad HTTP status',()=>{
 assert.throws(()=>requireLiveRevision(stale,main),/post_release_exact_head_mismatch/);
 assert.throws(()=>requireLiveRevision(main,stale),/post_release_exact_head_mismatch/);
});
test('v21.84 unavailable or malformed revision fails closed',()=>{
 for(const value of ['',null,undefined,'abc','0'.repeat(39)])
  assert.throws(()=>requireLiveRevision(value,main),/live_revision_missing_or_invalid/);
 for(const value of ['',null,undefined,'not-a-sha'])
  assert.throws(()=>requireLiveRevision(main,value),/expected_main_revision_missing_or_invalid/);
});
