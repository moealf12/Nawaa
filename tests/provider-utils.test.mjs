import assert from "node:assert/strict";
import test from "node:test";
import {parseMoney,normalizeAvailability,normalizeCondition} from "../server/provider-utils.mjs";

test("data integrity normalizers handle international money and explicit states",()=>{
  assert.equal(parseMoney("1.299,99 EUR"),1299.99);
  assert.equal(parseMoney("N/A"),null);
  assert.equal(parseMoney("--"),null);
  assert.equal(normalizeAvailability("Unavailable"),"out_of_stock");
  assert.equal(normalizeAvailability("Not Available"),"out_of_stock");
  assert.equal(normalizeAvailability("https://schema.org/InStock"),"in_stock");
  assert.equal(normalizeCondition("Renewed"),"refurbished");
  assert.equal(normalizeCondition("Refurbished"),"refurbished");
  assert.equal(normalizeCondition("Like New"),"used");
  assert.equal(normalizeCondition("New"),"new");
});
