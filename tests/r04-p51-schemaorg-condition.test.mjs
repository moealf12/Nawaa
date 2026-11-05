import test from "node:test";
import assert from "node:assert/strict";
import {normalizeCondition} from "../server/provider-utils.mjs";

test("R04-P51 RED: standard Schema.org OfferItemCondition URLs identify the item condition",()=>{
  assert.equal(normalizeCondition("https://schema.org/NewCondition"),"new");
  assert.equal(normalizeCondition("https://schema.org/UsedCondition"),"used");
  assert.equal(normalizeCondition("https://schema.org/RefurbishedCondition"),"refurbished");
  assert.equal(normalizeCondition("NewCondition"),"new");
  assert.equal(normalizeCondition("UsedCondition"),"used");
  assert.equal(normalizeCondition("RefurbishedCondition"),"refurbished");
});

test("R04-P51: unsafe URLs, missing evidence and other Schema.org enums are not new",()=>{
  for(const raw of ["","https://not-schema.org/NewCondition",
    "https://merchant.invalid/path/new", "https://schema.org/DamagedCondition",
    "https://schema.org/NewCondition?product=used",
    "https://schema.org/NewCondition#untrusted",
    { "@id": "https://not-schema.org/NewCondition" }]){
    assert.equal(normalizeCondition(raw),"unknown");
  }
  assert.equal(normalizeCondition({"@id":"https://schema.org/NewCondition"}),"new");
});

test("R04-P51: existing exact retail conditions remain backwards-compatible",()=>{
  for(const [input,wanted] of [
    ["new","new"],["brand new","new"],["used","used"],
    ["open box","open_box"],["renewed","refurbished"],
    ["refurbished","refurbished"],["pre owned","used"],
  ])assert.equal(normalizeCondition(input),wanted,input);
});
