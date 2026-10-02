import assert from "node:assert/strict";
import test from "node:test";
import {
  compareProductIdentity,
  identityCluster,
  productIdentity,
} from "../server/product-identity.mjs";

test("identity engine treats matching GTIN as the same product", () => {
  const result = compareProductIdentity(
    {name:"Apple iPhone 17 Pro 256GB",brand:"Apple",gtin13:"1234567890123"},
    {name:"iPhone 17 Pro 256 GB",brand:{name:"Apple"},gtin:"1234567890123"}
  );
  assert.equal(result.verdict,"same");
  assert.ok(result.matches.includes("gtin"));
  assert.ok(result.score >= 0.78);
});

test("identity engine rejects conflicting strong identifiers", () => {
  const result = compareProductIdentity(
    {name:"Phone Model A",brand:"BrandX",sku:"SKU-A"},
    {name:"Phone Model B",brand:"BrandX",sku:"SKU-B"}
  );
  assert.equal(result.verdict,"different");
  assert.ok(result.conflicts.includes("sku"));
});

test("identity engine can classify title and brand similarity without IDs", () => {
  const result = compareProductIdentity(
    {name:"Samsung Galaxy S26 Ultra 512GB Black",brand:"Samsung"},
    {name:"Samsung Galaxy S26 Ultra 512 GB - Black",brand:"Samsung"}
  );
  assert.ok(["same","likely_same"].includes(result.verdict));
  assert.ok(result.matches.includes("brand"));
});

test("identity cluster rejects unrelated recommendation candidates", () => {
  const anchor = {
    strategy:"domain_adapter",
    adapterId:"shein",
    confidence:0.96,
    product:{name:"Black Evening Dress",brand:"SHEIN",sku:"DRESS-1"},
  };
  const candidates = [
    anchor,
    {
      strategy:"jsonld",
      confidence:0.99,
      product:{name:"Black Evening Dress",brand:"SHEIN",sku:"DRESS-1"},
    },
    {
      strategy:"embedded_json",
      confidence:0.94,
      product:{name:"Wireless Bluetooth Speaker",brand:"SoundCo",sku:"SPK-9"},
    },
  ];

  const result = identityCluster(candidates, anchor);
  assert.equal(result.summary.accepted,2);
  assert.equal(result.summary.rejected,1);
  assert.deepEqual(result.summary.rejectedSources,["embedded_json"]);
});
