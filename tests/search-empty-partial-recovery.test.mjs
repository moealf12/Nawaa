import test from "node:test";
import assert from "node:assert/strict";
import {needsEmptyPartialRecovery,mergeEmptyPartialRecovery} from "../src/search-stream.mjs";

const query="سماعات بلوتوث";
const jarir={provider:"jarir-direct",providerMarket:"jarir-sa",merchant:"Jarir",
  title:"JBL Tune 770NC Bluetooth Headphones",
  sourceUrl:"https://www.jarir.com/sa-en/jbl-tune-770nc-headphones-123456.html",
  productPrice:299,currency:"SAR",availability:"unknown",condition:"new"};
const extra={provider:"extra-unbxd",providerMarket:"extra-sa",merchant:"eXtra",
  title:"JBL Tune 770NC Bluetooth Headphones",
  sourceUrl:"https://www.extra.com/en-sa/p/100462492",
  productPrice:319,currency:"SAR",availability:"unknown",condition:"new"};

test("empty partial SSE with a core source timeout permits only one ordinary JSON recovery",()=>{
  const old={offers:[],errors:[{sourceId:"extra-unbxd",error:"The operation was aborted due to timeout"}],
    coverage:{partial:true,returnedOffers:0},nextCursor:"old"};
  assert.equal(needsEmptyPartialRecovery(old),true);
  const refreshed={query,offers:[jarir,extra,jarir],errors:[],
    coverage:{partial:false,returnedOffers:3},nextCursor:"fresh"};
  const merged=mergeEmptyPartialRecovery(old,refreshed,query);
  assert.deepEqual(merged.offers,[jarir,extra]);
  assert.equal(merged.nextCursor,"fresh");
  assert.equal(merged.recovery.type,"fresh-json-empty-partial");
  assert.equal(merged.recovery.addedOffers,2);
  assert.deepEqual(old.offers,[]);
});

test("permanent denial, clean no-match and unrelated source failures never retry",()=>{
  for(const bad of [
    {offers:[],errors:[],coverage:{partial:false}},
    {offers:[],errors:[{sourceId:"extra-unbxd",error:"HTTP 403"}],coverage:{partial:true}},
    {offers:[],errors:[{sourceId:"extra-unbxd",error:"HTTP 429"}],coverage:{partial:true}},
    {offers:[],errors:[{sourceId:"noon-sa",error:"timeout"}],coverage:{partial:true}},
    {offers:[jarir],errors:[{sourceId:"extra-unbxd",error:"timeout"}],coverage:{partial:true}},
  ]){
    assert.equal(needsEmptyPartialRecovery(bad),false,JSON.stringify(bad.errors));
    assert.equal(mergeEmptyPartialRecovery(bad,{query,offers:[extra]},query),bad);
  }
});

test("zero-offer recovery fails closed for mismatched query or malformed and unsafe offers",()=>{
  const old={offers:[],errors:[{sourceId:"jarir-direct",error:"deadline exceeded"}],coverage:{partial:true}};
  assert.equal(needsEmptyPartialRecovery(old),true);
  assert.equal(mergeEmptyPartialRecovery(old,{query:"iPhone 17",offers:[jarir]},query),old);
  assert.equal(mergeEmptyPartialRecovery(old,{query,offers:[]},query),old);
  assert.equal(mergeEmptyPartialRecovery(old,{query,offers:[{...jarir,productPrice:0}]},query),old);
  assert.equal(mergeEmptyPartialRecovery(old,{query,offers:[{...jarir,sourceUrl:"javascript:alert(1)"}]},query),old);
  assert.equal(mergeEmptyPartialRecovery(old,{query,offers:[{...jarir,sourceUrl:"https://www.jarir.com@evil.example/p"}]},query),old);
});

test("fresh eligible JSON offers retain their original merchant and price without trust promotion",()=>{
  const old={offers:[],errors:[{provider:"extra-unbxd",error:"AbortError: timeout"}],
    coverage:{partial:true}};
  const refreshed={query,offers:[jarir],coverage:{partial:true,complete:false}};
  const merged=mergeEmptyPartialRecovery(old,refreshed,query);
  assert.equal(merged.offers[0],jarir);
  assert.equal(merged.offers[0].productPrice,299);
  assert.equal(merged.offers[0].merchant,"Jarir");
  assert.equal(merged.offers[0].independentlyAttested,undefined);
  assert.equal(merged.coverage.partial,true);
});
