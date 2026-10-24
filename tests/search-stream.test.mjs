import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSearchStreamResult} from '../src/search-stream.mjs';

test('stream completion keeps live offers and final pagination metadata',()=>{
  const withOffers={
    offers:[{sourceUrl:'https://www.amazon.sa/dp/B0TEST1234',productPrice:2499}],
    coverage:{partial:true,complete:false},
    nextCursor:null,
    cache:{mode:'progress'},
  };
  const finalSnapshot={
    offers:[],
    coverage:{partial:false,complete:true,providersPending:0},
    nextCursor:'depth-1',
    cache:{mode:'refresh'},
    errors:[{sourceId:'example',error:'timeout'}],
  };

  assert.deepEqual(selectSearchStreamResult(finalSnapshot,withOffers),{
    ...finalSnapshot,
    offers:withOffers.offers,
  });
});

test('stream completion returns the final snapshot when no offers were observed',()=>{
  const finalSnapshot={offers:[],nextCursor:'depth-1'};
  assert.equal(selectSearchStreamResult(finalSnapshot,null),finalSnapshot);
});

import fc from 'fast-check';

test('property: a late empty diagnostic preserves the latest sellable offers and authoritative completion data',()=>{
  fc.assert(fc.property(
    fc.array(fc.integer({min:100,max:300000}),{minLength:1,maxLength:12}),
    fc.string({minLength:1,maxLength:24}),
    fc.boolean(),
    (prices,cursor,partial)=>{
      const snapshots=prices.map((price,i)=>({
        offers:[{sourceUrl:'https://merchant.example/product/'+i,productPrice:price,
          currency:'SAR',merchant:'Fixture Merchant'}],
        coverage:{partial:true,complete:false},
      }));
      const lastWithOffers=snapshots.at(-1);
      const terminal={offers:[],nextCursor:cursor,
        coverage:{partial,complete:!partial,providersPending:0},
        errors:partial?[{sourceId:'fixture',error:'partial'}]:[]};
      const before=structuredClone({lastWithOffers,terminal});
      const result=selectSearchStreamResult(terminal,lastWithOffers);
      assert.deepEqual(result.offers,lastWithOffers.offers);
      assert.equal(result.nextCursor,cursor);
      assert.deepEqual(result.coverage,terminal.coverage);
      assert.deepEqual(result.errors,terminal.errors);
      assert.deepEqual({lastWithOffers,terminal},before,
        'final SSE reconciliation must not mutate the underlying records');
    }
  ),{seed:2156,numRuns:64});
});

test('v21.68 cross-generation stale offers cannot pollute a new final SSE snapshot',()=>{
  const current='11111111-2222-4333-8444-555555555555';
  const old='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const final={streamGeneration:current,offers:[],nextCursor:'signed-depth1'};
  const stale={streamGeneration:old,offers:[{title:'old product',productPrice:1}]};
  assert.deepEqual(selectSearchStreamResult(final,stale),final);
  const matching={...stale,streamGeneration:current};
  assert.deepEqual(selectSearchStreamResult(final,matching).offers,matching.offers);
  assert.deepEqual(selectSearchStreamResult(final,{...stale,streamGeneration:undefined}),final,
    'legacy snapshot must never fill a new generation final result');
  assert.deepEqual(selectSearchStreamResult(
    {...final,streamGeneration:undefined},matching),
    {...final,streamGeneration:undefined},
    'new snapshot must never pollute a legacy final result');
});
test('v21.68 SSE correlation rejects missing, malformed or mismatched generations and tolerates legacy',async()=>{
  const {acceptedStreamGeneration}=await import('../src/search-stream.mjs');
  const generation='12345678-1234-4abc-8123-123456789abc';
  assert.equal(acceptedStreamGeneration(generation,generation),true);
  for(const incoming of [null,undefined,'',{},'another','12345678-1234-4abc-8123-123456789abd']){
    assert.equal(acceptedStreamGeneration(generation,incoming),false);
  }
  assert.equal(acceptedStreamGeneration(null,undefined),true,
    'old API snapshots still show normal products, never trust badges');
});
