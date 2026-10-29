import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSearchStreamResult,needsExtraSourceRecovery,mergeExtraSourceRecovery} from '../src/search-stream.mjs';

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

test("source timeout permits one fresh JSON eXtra recovery while retaining Jarir",()=>{
  const jarir={provider:"jarir-direct",merchant:"Jarir",
    sourceUrl:"https://www.jarir.com/sa-en/123.html",productPrice:3799,currency:"SAR"};
  const original={offers:[jarir],errors:[{sourceId:"extra-unbxd",error:"The operation was aborted due to timeout"}],
    coverage:{partial:true,returnedOffers:1}};
  const extra={provider:"extra-unbxd",providerMarket:"extra-sa",merchant:"eXtra",
    sourceUrl:"https://www.extra.com/en-sa/p/100462492",
    sourceMeta:{productId:"100462492"},currency:"SAR",productPrice:3299};
  assert.equal(needsExtraSourceRecovery(original),true);
  const result=mergeExtraSourceRecovery(original,{offers:[extra,extra,
    {...extra,sourceUrl:"https://www.extra.com.evil.test/en-sa/p/100462492"},
    {...extra,sourceUrl:"https://www.extra.com/en-sa/p/100462493"},
    {...extra,provider:"wrong-source"},
    {provider:"shopify",merchant:"Some Shop",sourceUrl:"https://shop.example/item",productPrice:1}
  ]});
  assert.equal(result.offers.length,2);
  assert.equal(result.offers[0],jarir);
  assert.equal(result.offers[1],extra);
  assert.equal(result.offers[1].productPrice,3299);
  assert.deepEqual(result.recovery,{sourceId:"extra-unbxd",type:"fresh-json",addedOffers:1});
  assert.equal(result.coverage.partial,true);
  assert.equal(original.offers.length,1);
});

test("source recovery neither invents prices nor requests JSON when no timeout",()=>{
  const sample={offers:[],errors:[{sourceId:"extra-unbxd",error:"HTTP 429"}]};
  assert.equal(needsExtraSourceRecovery(sample),false);
  assert.equal(mergeExtraSourceRecovery(sample,{offers:[]}),sample);
  const already={offers:[{merchant:"eXtra",sourceUrl:"https://www.extra.com/en-sa/p/100462492"}],
    errors:[{sourceId:"extra-unbxd",error:"timeout"}]};
  assert.equal(needsExtraSourceRecovery(already),false);
  assert.equal(mergeExtraSourceRecovery(already,{offers:[]}),already);
  const empty={offers:[],errors:[{sourceId:"extra-unbxd",error:"timeout"}]};
  assert.equal(mergeExtraSourceRecovery(empty,{offers:[{merchant:"eXtra",productPrice:0}]}),empty);
});
