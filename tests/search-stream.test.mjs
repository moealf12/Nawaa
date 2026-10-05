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
