import test from "node:test";
import assert from "node:assert/strict";
import {productCategory,assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

// Real first-screen title: Q15 HP laptop 16GB RAM, GitHub LIVE run 41249009245.
// Independent seller page https://www.ebay.de/itm/178535835066 confirms
// L34280-601 is an HP EliteBook 1030 G3 MAINBOARD, NOT a complete notebook.
const observed="L34280-601 für HP EliteBook x360 1030 G3 mit Intel Core i7-8650U und 16 GB RAM";
const mk=title=>({title,merchant:"Recorded real title",sourceUrl:"https://example.invalid/replay-hp-part",
  productPrice:1200,currency:"SAR",condition:"new",specs:{},availability:"unknown"});
test("R04 RED: verified HP motherboard rank #1 must not match requested HP laptop",()=>{
  const item=mk(observed),query="HP laptop 16GB RAM";
  assert.equal(productCategory(item),"accessory");
  assert.equal(assessOfferMatch(query,item).exactMatch,false);
  assert.equal(filterQueryOffers(query,[item]).offers.length,0);
});
test("R04 RED: explicit motherboard subject is an independent laptop replacement part",()=>{
  const item=mk("HP EliteBook x360 1030 G3 Mainboard L34280-601 Intel Core i7 16GB RAM");
  assert.equal(productCategory(item),"accessory");
  assert.equal(filterQueryOffers("HP laptop 16GB RAM",[item]).offers.length,0);
});
test("R04: complete HP notebook that includes an extra motherboard remains a notebook",()=>{
  const full=mk("HP EliteBook 840 G6 Business Laptop Intel Core i7 16GB RAM with included spare motherboard");
  assert.equal(productCategory(full),"laptop");
  assert.equal(assessOfferMatch("HP laptop 16GB RAM",full).exactMatch,true);
});
