import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {summarizeDiagnosticLatencyGroup as summary} from '../scripts/latency-diagnostic-summary.mjs';

test('v21.78 latency smoke never fabricates P95 certification for fast biased samples',()=>{
  for(const n of [0,1,3,10,20,100]){
    const result=summary(Array.from({length:n},(_,i)=>({
      firstValidOfferMs:i+1,firstExactOfferMs:i+1})),
      {sha:'candidate',q:'PS5',phase:'process-cold'});
    assert.equal(result.sampleP95Ms,null);
    assert.equal(result.sloCertified,false);
    assert.equal(result.certificationStatus,'DIAGNOSTIC_ONLY');
    assert.equal(result.n,n);
    assert.equal(result.successes,n);
    assert.equal(result.missingValidOffers,0);
  }
});

test('v21.78 failure and censored samples stay in denominator, never produce false success',()=>{
  const result=summary([
    {firstValidOfferMs:130,firstExactOfferMs:150},
    {firstValidOfferMs:null,firstExactOfferMs:null,error:'timeout'},
    {firstValidOfferMs:300,firstExactOfferMs:350},
    {firstValidOfferMs:null,error:'no-valid-offer'}
  ],{sha:'candidate',q:'iPhone 17',phase:'process-warm'});
  assert.equal(result.n,4);
  assert.equal(result.successes,2);
  assert.equal(result.missingValidOffers,2);
  assert.equal(result.firstExactSuccesses,2);
  assert.equal(result.medianMs,130); // original nearest-rank median
  assert.equal(result.maxMs,300);
  assert.equal(result.sloCertified,false);
});
test('v21.78 property: bounded smoke diagnostic cannot become P95-authoritative',()=>{
  fc.assert(fc.property(
    fc.array(fc.oneof(fc.integer({min:0,max:25000}),fc.constant(null)),
      {minLength:0,maxLength:10}),
    samples=>{
      const observed=samples.map(v=>({firstValidOfferMs:v,firstExactOfferMs:v}));
      const result=summary(observed,{sha:'candidate',q:'PS5',phase:'process-cold'});
      const n=samples.filter(x=>x!==null).length;
      assert.equal(result.n,samples.length);
      assert.equal(result.successes,n);
      assert.equal(result.missingValidOffers,samples.length-n);
      assert.equal(result.sampleP95Ms,null);
      assert.equal(result.sloCertified,false);
      if(n){
        assert.ok(result.maxMs>=result.medianMs);
      }else{
        assert.equal(result.maxMs,null);
        assert.equal(result.medianMs,null);
      }
    }
  ),{numRuns:100,seed:2178});
});
