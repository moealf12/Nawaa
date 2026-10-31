import test from "node:test";
import assert from "node:assert/strict";
import {productCategory,assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

// Literal first-screen product title recorded in successful GitHub Actions
// production query Q04 (Arabic), run 41245264321. Replay, NOT live inventory.
const sourceTitle="Samsung Galaxy Official S25 Ultra S Pen for Galaxy S25 Ultra Grey SM-S938N";
const offer=title=>({title,merchant:"Recorded source title",sourceUrl:"https://example.invalid/r04-spen-replay",
  productPrice:500,currency:"SAR",condition:"new",availability:"unknown",specs:{}});
test("R04 RED: actual Arabic S25 Ultra rank-2 standalone S Pen must not match the phone",()=>{
  const item=offer(sourceTitle),query="سامسونج جالكسي S25 الترا";
  assert.equal(productCategory(item),"accessory",sourceTitle);
  assert.equal(assessOfferMatch(query,item).exactMatch,false);
  assert.deepEqual(filterQueryOffers(query,[item]).offers,[]);
});
test("R04: standalone S Pen stylus is not a handset in English or Arabic searches",()=>{
  for(const query of ["Samsung Galaxy S25 Ultra","سامسونج جالكسي S25 الترا"]){
    for(const title of ["S Pen for Samsung Galaxy S25 Ultra", "Original Samsung Galaxy S25 Ultra S Pen Replacement Stylus"]){
      const item=offer(title);
      assert.equal(productCategory(item),"accessory",title);
      assert.equal(assessOfferMatch(query,item).exactMatch,false,title);
      assert.equal(filterQueryOffers(query,[item]).offers.length,0,title);
    }
  }
});
test("R04: genuine Galaxy S25 Ultra handset with included S Pen stays a phone",()=>{
  for(const title of [
    "Samsung Galaxy S25 Ultra 256GB Smartphone with included S Pen",
    "Samsung Galaxy S25 Ultra 256GB 12GB RAM Smartphone",
    "Samsung Galaxy S25 Ultra 256GB Smartphone S Pen Included",
  ]){
    const item=offer(title);
    assert.equal(productCategory(item),"phone",title);
    assert.equal(assessOfferMatch("Samsung Galaxy S25 Ultra",item).exactMatch,true,title);
    assert.equal(filterQueryOffers("Samsung Galaxy S25 Ultra",[item]).offers.length,1,title);
  }
});
