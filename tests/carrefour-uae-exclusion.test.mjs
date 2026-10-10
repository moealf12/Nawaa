import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredFreeStorefronts,
  selectedStores,
  routeFreeStorefronts,
  searchFreeStorefrontById,
} from "../server/providers/free-storefronts.mjs";
import { configuredProviders } from "../server/source-config.mjs";
import { parseCarrefourSearchPayload } from "../server/providers/carrefour.mjs";

test("Carrefour UAE is absent from every active free-storefront registration", () => {
  const stores = configuredFreeStorefronts();
  assert.ok(!stores.some(store => store.id === "carrefour-ae"));
  for (const query of ["iPhone 17", "Laptop", "carrefour", "سوبرماركت"]) {
    assert.ok(!selectedStores(query).some(store => store.id === "carrefour-ae"));
    assert.ok(!routeFreeStorefronts(query).some(entry => entry.store?.id === "carrefour-ae"));
  }
  assert.ok(!configuredProviders().some(id => id === "free-storefronts:carrefour-ae"));
});

test("explicit Carrefour UAE search ID fails before any network request", async () => {
  await assert.rejects(
    searchFreeStorefrontById("carrefour-ae", "iPhone 17"),
    /unknown storefront: carrefour-ae/
  );
});

test("Carrefour Saudi remains a separate, intact provider", () => {
  assert.equal(typeof parseCarrefourSearchPayload, "function");
  const before = process.env.CARREFOUR_ENABLED;
  try {
    process.env.CARREFOUR_ENABLED = "true";
    assert.ok(configuredProviders().includes("carrefour-ksa"));
    assert.ok(!configuredProviders().includes("free-storefronts:carrefour-ae"));
  } finally {
    if (before === undefined) delete process.env.CARREFOUR_ENABLED;
    else process.env.CARREFOUR_ENABLED = before;
  }
});
