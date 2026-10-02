import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateCandidateFreshness,
  candidateObservedAt,
  freshnessFor,
  freshnessSummary,
} from "../server/freshness.mjs";
import { choosePreferredCandidate } from "../server/conflict-resolution.mjs";

test("freshness engine reads timestamps from product and offers", () => {
  const entry = {
    strategy:"jsonld",
    product:{dateModified:"2026-10-02T00:00:00Z"},
  };
  assert.equal(candidateObservedAt(entry),"2026-10-02T00:00:00.000Z");

  const offerEntry = {
    strategy:"storefront_data",
    product:{offers:{price:100,priceCurrency:"SAR",updatedAt:"2026-10-02T01:00:00Z"}},
  };
  assert.equal(candidateObservedAt(offerEntry),"2026-10-02T01:00:00.000Z");
});

test("freshness engine marks old evidence stale", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const result = freshnessFor({
    strategy:"jsonld",
    observedAt:"2026-10-01T00:00:00Z",
    product:{},
  }, now);
  assert.equal(result.status,"stale");
  assert.equal(result.stale,true);
  assert.equal(result.freshness,0.2);
});

test("fresh commerce evidence can outrank older higher-confidence price data", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const candidates = annotateCandidateFreshness([
    {
      strategy:"jsonld",
      confidence:0.99,
      observedAt:"2026-09-29T12:00:00Z",
      product:{name:"Product",offers:{price:100,priceCurrency:"SAR"}},
    },
    {
      strategy:"domain_adapter",
      adapterId:"shein",
      confidence:0.96,
      observedAt:"2026-10-02T11:55:00Z",
      product:{name:"Product",offers:{price:85,priceCurrency:"SAR"}},
    },
  ], null, now);

  const preferred = choosePreferredCandidate(
    candidates,
    "price",
    (entry) => Boolean(entry.product?.offers?.price)
  );
  assert.equal(preferred?.strategy,"domain_adapter");
});

test("freshness summary exposes stale and unknown sources", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const candidates = annotateCandidateFreshness([
    {strategy:"jsonld",observedAt:"2026-09-29T00:00:00Z",product:{}},
    {strategy:"meta",product:{}},
  ], null, now);
  const summary = freshnessSummary(candidates);
  assert.deepEqual(summary.staleSources,["jsonld"]);
  assert.deepEqual(summary.unknownFreshnessSources,["meta"]);
});
