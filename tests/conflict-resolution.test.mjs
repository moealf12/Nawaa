import assert from "node:assert/strict";
import test from "node:test";
import {
  choosePreferredCandidate,
  conflictSummary,
  detectCandidateConflicts,
} from "../server/conflict-resolution.mjs";

test("price conflicts prefer commerce-specific domain adapter evidence", () => {
  const candidates = [
    {
      strategy:"jsonld",
      confidence:0.99,
      product:{
        name:"Same Product",
        offers:{price:100,priceCurrency:"SAR",availability:"https://schema.org/InStock"},
      },
    },
    {
      strategy:"domain_adapter",
      adapterId:"shein",
      confidence:0.96,
      product:{
        name:"Same Product",
        offers:{price:85,priceCurrency:"SAR",availability:"instock"},
      },
    },
  ];

  const conflicts = detectCandidateConflicts(candidates);
  const price = conflicts.find((item) => item.field === "price");
  assert.equal(price?.severity,"high");
  assert.equal(price?.resolvedSource,"domain_adapter:shein");
  assert.equal(price?.deltaPct,0.15);

  const preferred = choosePreferredCandidate(
    candidates,
    "price",
    (entry) => Boolean(entry.product?.offers?.price)
  );
  assert.equal(preferred?.strategy,"domain_adapter");
});

test("availability conflicts are surfaced separately", () => {
  const candidates = [
    {
      strategy:"jsonld",
      confidence:0.99,
      product:{name:"Product",offers:{price:100,priceCurrency:"SAR",availability:"instock"}},
    },
    {
      strategy:"storefront_data",
      confidence:0.95,
      product:{name:"Product",offers:{price:100,priceCurrency:"SAR",availability:"outofstock"}},
    },
  ];

  const conflicts = detectCandidateConflicts(candidates);
  const availability = conflicts.find((item) => item.field === "availability");
  assert.equal(availability?.severity,"medium");
  assert.equal(availability?.resolvedSource,"storefront_data");
});

test("large title disagreements are reported", () => {
  const conflicts = detectCandidateConflicts([
    {strategy:"jsonld",confidence:0.99,product:{name:"Apple iPhone 17 Pro Max"}},
    {strategy:"meta",confidence:0.72,product:{name:"Wireless Kitchen Blender"}},
  ]);
  const name = conflicts.find((item) => item.field === "name");
  assert.equal(name?.severity,"high");
  assert.equal(name?.resolvedSource,"jsonld");
});

test("conflict summary reports affected fields", () => {
  const summary = conflictSummary([
    {field:"price",severity:"high"},
    {field:"availability",severity:"medium"},
    {field:"price",severity:"medium"},
  ]);
  assert.equal(summary.hasConflicts,true);
  assert.equal(summary.count,3);
  assert.equal(summary.highSeverity,1);
  assert.deepEqual(summary.fields,["price","availability"]);
});
