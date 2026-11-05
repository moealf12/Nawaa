#!/usr/bin/env node
/**
 * Feed actual Chromium JSON report into native NAWAA P4 decision engine.
 * This cannot certify a price because browser-only output has no original
 * search evidence and no selected SKU/live buybox proof.
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateAliExpressBrowserDiagnostic as decide}
  from "../src/aliexpress-product-evidence.mjs";

const id=String(process.env.ALIEXPRESS_ITEM_ID||"");
assert.match(id,/^\d{10,20}$/);
const report=JSON.parse(
  readFileSync("aliexpress-browser-dom-"+id+".json","utf8")
);
assert.equal(report.requestedItemId,id);
assert.equal(report.customerPublishable,false);
const verdict=decide(report);
assert.equal(verdict.status,"UNVERIFIED");
assert.equal(verdict.eligibleForPublication,false);
assert.equal(verdict.customerPublishable,false);
assert.equal(verdict.pdpPriceVerified,false);
assert.equal(verdict.originalItemId,id);
const summary={
  schema:verdict.schema,status:verdict.status,reason:verdict.reason,
  originalItemId:verdict.originalItemId,finalItemId:verdict.finalItemId,
  eligibleForPublication:false,customerPublishable:false,
  selectedVariantAttested:false,sourceSearchPriceAttested:false,
};
console.log("NAWAA_ALIEXPRESS_P4_LIVE_VERDICT "+JSON.stringify(summary));
