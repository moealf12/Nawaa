import test from 'node:test';
import assert from 'node:assert/strict';

test('repeated and concurrent queries reuse fresh results without sharing mutable offers', async () => {
  const mod = await import('../server/search-cache.mjs').catch(() => ({}));
  assert.equal(typeof mod.createSearchCache, 'function');
  let now = 0, calls = 0;
  const search = mod.createSearchCache(async () => { calls++; return {offers:[{title:'phone'}],errors:[]}; }, {ttl:100, maxEntries:2, now:()=>now});
  const [a,b] = await Promise.all([search('iphone 17'),search('iphone 17')]);
  a.offers.length = 0;
  assert.equal(b.offers.length,1);
  assert.equal(calls,1);
  assert.equal((await search('iphone 17')).offers.length,1);
  now=101;await search('iphone 17');assert.equal(calls,2);
  await search('b');await search('c');await search('iphone 17');assert.equal(calls,5);
});

test('partial source failures are retried rather than cached', async () => {
  const mod = await import('../server/search-cache.mjs').catch(() => ({}));
  assert.equal(typeof mod.createSearchCache,'function');
  let calls=0;
  const search=mod.createSearchCache(async()=>{calls++;return {offers:[],errors:[{provider:'jarir'}]};});
  await search('iphone');await search('iphone');assert.equal(calls,2);
});
