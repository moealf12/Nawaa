import test from 'node:test';
import assert from 'node:assert/strict';
import {routeFreeStorefronts,searchFreeStorefronts} from '../server/providers/free-storefronts.mjs';
import {sourceReliability} from '../server/source-reliability.mjs';

const query='PS5 Slim';
const routed=routeFreeStorefronts(query,Infinity,{stable:true});
const offset=routed.findIndex(entry=>entry.store.id==='temu-global');
assert.ok(offset>=0,'fixture must select a genuine routed Temu storefront');

async function inspectOneTemuPage(html) {
  const oldFetch=globalThis.fetch;
  sourceReliability.reset('temu-global');
  let calls=0;
  try {
    globalThis.fetch=async input=>{
      calls++;
      assert.equal(new URL(String(input)).hostname,'www.temu.com');
      return new Response(html,{
        status:200,headers:{'content-type':'text/html; charset=utf-8'}
      });
    };
    const result=await searchFreeStorefronts(query,{
      stableRouting:true,storeOffset:offset,storeLimit:1,productPageLimit:1,
      storeDeadlineMs:3000,matchingQuery:query,
    });
    return {result,calls,health:sourceReliability.view('temu-global')};
  } finally {
    globalThis.fetch=oldFetch;
    sourceReliability.reset('temu-global');
  }
}

test('blocked HTTP-200 Temu bootstrap shell is one source failure, not a successful empty search',async()=>{
  const {result,health,calls}=await inspectOneTemuPage('<html><body>Temu loading...</body></html>');
  assert.ok(calls>=1);
  assert.equal(result.offers.length,0);
  assert.equal(result.searchedMarkets[0].id,'temu-global');
  assert.deepEqual(result.errors.map(x=>x.error),[
    'Storefront blocked: thin_search_shell'
  ],'blocked shell must not produce an extra redundant no-offers error');
  assert.equal(health.consecutiveFailures,1,'known bot-block must count as acquisition failure');
  assert.ok(health.transportSuccessRate<0.8,'failed acquisition must reduce reliability, not raise it');
});

test('valid empty Temu search is NOT a transport failure or false source warning',async()=>{
  const {result,health}=await inspectOneTemuPage('<html><body>'+('search completed with no relevant products '.repeat(550))+'</body></html>');
  assert.equal(result.offers.length,0);
  assert.equal(result.errors.length,0,'legitimately empty catalog is a zero-yield observation');
  assert.equal(health.consecutiveFailures,0);
  assert.ok(health.transportSuccessRate>0.8);
});
