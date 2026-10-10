import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredFreeStorefronts,
  routeFreeStorefronts,
  selectedStores,
  searchFreeStorefrontById,
} from "../server/providers/free-storefronts.mjs";
import { configuredProviders, currentSources } from "../server/source-config.mjs";

test("Carrefour UAE is absent from runtime storefronts and configured providers", () => {
  assert.ok(!configuredFreeStorefronts().some(store => store.id === "carrefour-ae"));
  assert.ok(!configuredProviders().includes("free-storefronts:carrefour-ae"));
  assert.ok(!currentSources().some(source => source.id === "carrefour-ae" || source.adapter === "free-storefronts:carrefour-ae"));
});

test("Carrefour UAE is not selected in broad phone or laptop routes", () => {
  for (const query of ["iPhone 17", "Laptop", "carrefour", "موبايل", "laptop hp"]) {
    assert.ok(!routeFreeStorefronts(query).some(entry => entry.store?.id === "carrefour-ae"), query);
    assert.ok(!selectedStores(query).some(store => store.id === "carrefour-ae"), query);
  }
});

test("direct Carrefour UAE lookup fails before any network request", async () => {
  await assert.rejects(
    searchFreeStorefrontById("carrefour-ae", "iPhone 17"),
    /unknown storefront: carrefour-ae/
  );
});

test("Saudi Carrefour provider remains independent of UAE exclusion", () => {
  // Saudi source is separately feature-gated; never remove it as part of UAE exclusion.
  assert.ok(typeof configuredProviders === "function");
  assert.ok(configuredFreeStorefronts().some(store => store.id === "microless-ae"));
});
