import assert from "node:assert/strict";
import {
  calculateComparableTotal,
  classifyOffer,
  findBestProduct,
  productMatchScore,
  rankOffers,
  DEMO_CATALOG,
} from "../src/search-core.mjs";

const exact = {
  productPrice: 900,
  shipping: 20,
  importCost: 0,
  tax: 0,
  mandatoryFees: 10,
  discount: 30,
  condition: "new",
  availability: "in_stock",
  canShipToSaudi: true,
  exactMatch: true,
  matchConfidence: 0.98,
  priceConfidence: "confirmed",
};

assert.equal(calculateComparableTotal(exact), 900);
assert.equal(classifyOffer(exact), "confirmed");
assert.equal(classifyOffer({ ...exact, shipping: null }), "incomplete");
assert.equal(classifyOffer({ ...exact, exactMatch: false, matchConfidence: 0.7 }), "probable");
assert.equal(classifyOffer({ ...exact, condition: "open_box" }), "ineligible");

const ranked = rankOffers([
  { ...exact, merchant: "A", productPrice: 930 },
  { ...exact, merchant: "B", productPrice: 890 },
  { ...exact, merchant: "C", productPrice: 700, exactMatch: false, matchConfidence: 0.7 },
]);
assert.equal(ranked[0].merchant, "B");
assert.equal(ranked.at(-1).merchant, "C");

const airpods = DEMO_CATALOG[0];
assert.ok(productMatchScore("ايربودز برو 2 usb c", airpods) >= 0.75);
assert.equal(findBestProduct("MTJV3", DEMO_CATALOG)?.product.id, "airpods-pro-2-usbc");
assert.equal(findBestProduct("something totally unrelated", DEMO_CATALOG), null);

console.log("NAWAA search-core tests passed");
