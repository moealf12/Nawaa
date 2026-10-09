import test from "node:test";
import assert from "node:assert/strict";
import {pricePlausibility} from "../server/price-plausibility.mjs";

test("rejects clearly invalid AirPods Max search-card prices",()=>{
  assert.deepEqual(pricePlausibility("Apple AirPods Max 2 - Starlight",2.04),
    {ok:false,reason:"implausibly_low_high_value_device",minimumSar:250});
  assert.equal(pricePlausibility("Apple AirPods Max 2 - Starlight",1900).ok,true);
});
test("protects new phone and laptop listings from unit/decimal extraction errors",()=>{
  assert.equal(pricePlausibility("Apple iPhone 17 256GB",3.99).ok,false);
  assert.equal(pricePlausibility("HP Laptop 16GB RAM",5).ok,false);
  assert.equal(pricePlausibility("Samsung Galaxy S25",4.5).ok,false);
});
test("does not reject legitimate low-cost accessories",()=>{
  for(const title of ["iPhone 17 Case","MacBook charging cable","AirPods Max protective cover","laptop sleeve"]) {
    assert.equal(pricePlausibility(title,8).ok,true,title);
  }
  assert.equal(pricePlausibility("Desk lamp",8).ok,true);
});
test("always rejects invalid price amounts",()=>{
  assert.equal(pricePlausibility("Desk lamp",0).ok,false);
  assert.equal(pricePlausibility("Apple AirPods Max",NaN).ok,false);
});
