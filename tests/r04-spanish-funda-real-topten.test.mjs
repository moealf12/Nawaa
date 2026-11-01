import test from "node:test";
import assert from "node:assert/strict";
import {productCategory, assessOfferMatch, filterQueryOffers} from "../src/search-query.mjs";
import {provisionalLabel} from "../scripts/verify-r04-live-ranking.mjs";

// Evidence: R04 post-PR #245 LIVE Q03 at rank #1, run 41249353982.
// Spanish retail subject "Funda" = a separately sold case, not the compatible phone.
const observed="Funda/Funda Original/Oficial Samsung Galaxy S25 Ultra Flipsuit - Blanca - Nueva";
const mk=title=>({title,merchant:"Recorded title replay",sourceUrl:"https://example.invalid/r04-funda-replay",productPrice:1200,currency:"SAR",condition:"new",availability:"unknown",specs:{}});

test("R04 RED: recorded Spanish Funda top-one is not a Galaxy S25 Ultra handset",()=>{
  const offer=mk(observed),query="Samsung Galaxy S25 Ultra";
  assert.equal(productCategory(offer),"accessory");
  assert.equal(assessOfferMatch(query,offer).exactMatch,false);
  assert.equal(filterQueryOffers(query,[offer]).offers.length,0);
});

test("R04 RED: independent first-screen grader must not certify Spanish Funda as handset",()=>{
  const a=provisionalLabel("galaxy",{title:observed,exactMatch:true,matchConfidence:1,productPrice:1});
  const b=provisionalLabel("galaxy",{title:observed,exactMatch:false,matchConfidence:0,productPrice:100000});
  assert.deepEqual(a,{grade:0,reason:"spanish_case_retail_subject"});
  assert.deepEqual(a,b);
});

test("R04 protection: complete Galaxy handset with bundled Spanish funda remains a phone",()=>{
  const title="Samsung Galaxy S25 Ultra 256GB Smartphone con funda protectora incluida";
  const offer=mk(title);
  assert.notEqual(productCategory(offer),"accessory");
  assert.equal(assessOfferMatch("Samsung Galaxy S25 Ultra",offer).exactMatch,true);
  assert.equal(provisionalLabel("galaxy",{title}).grade,3);
});
