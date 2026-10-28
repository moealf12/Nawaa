import test from "node:test";
import assert from "node:assert/strict";
import {describeProduct,assessOfferMatch} from "../src/search-query.mjs";

const listing = (title) => ({
  title,merchant:"Amazon Saudi",brand:"Sony",sourceUrl:"https://www.amazon.sa/dp/B0DXXHM2S4",
  currency:"SAR",productPrice:3232.99,
});

test("live observed PS5 Slim console with extra controller and game is not discarded as an accessory",()=>{
  const offer=listing("Sony PlayStation 5 Slim Disc with Extra Dualsense White Controller + Black Myth: Wukong -International Version");
  const identity=describeProduct(offer);
  assert.equal(identity.kind,"console");
  assert.equal(identity.isBundle,true);
  const matched=assessOfferMatch("PS5 Slim",offer);
  assert.equal(matched.productKind,"console");
  assert.ok(matched.matchConfidence>=0.35,JSON.stringify(matched));
});

test("console-edition retail packages without the literal word console remain discoverable",()=>{
  for(const title of [
    "Sony PS5 Slim Digital with Additional DualSense Controller",
    "Sony PS5 Pro Disc with DualSense Controller",
  ]){
    assert.equal(describeProduct(listing(title)).kind,"console",title);
    assert.ok(assessOfferMatch("PS5",listing(title)).matchConfidence>=0.35,title);
  }
});

test("compatibility accessories and standalone peripherals never inherit console identity",()=>{
  for(const title of [
    "PS5 Slim Disc Drive with Extra DualSense Controller",
    "PS5 Slim Disc Cover with Controller",
    "Protective case for PS5 Slim Disc with controller",
    "PS5 Slim Disc game with controller",
    "PS5 Slim Console Hub with Controller",
    "PS5 Slim Disc SSD with controller",
  ]) {
    assert.notEqual(describeProduct(listing(title)).kind,"console",title);
    assert.ok(assessOfferMatch("PS5 Slim",listing(title)).matchConfidence < 0.35,title);
  }
});
