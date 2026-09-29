import assert from "node:assert/strict";
import { assessOfferMatch, dedupeNormalizedOffers } from "../server/match.mjs";
import { normalizeCondition, parseMoney } from "../server/provider-utils.mjs";

assert.equal(normalizeCondition("Brand New"), "new");
assert.equal(normalizeCondition("Open Box"), "open_box");
assert.equal(parseMoney("$1,299.99"), 1299.99);

const iphone = assessOfferMatch("iPhone 17 256GB", {
  title: "Apple iPhone 17 256GB Black Factory Unlocked",
  condition: "new",
});
assert.equal(iphone.exactMatch, true);
assert.ok(iphone.matchConfidence >= 0.92);

const accessory = assessOfferMatch("iPhone 17", {
  title: "Protective Case Cover for iPhone 17",
  condition: "new",
});
assert.equal(accessory.exactMatch, false);
assert.ok(accessory.matchConfidence < 0.5);

const unique = dedupeNormalizedOffers([
  { provider:"ebay", sourceUrl:"https://x/1", title:"iPhone 17", originalProductPrice:900, originalCurrency:"USD" },
  { provider:"ebay", sourceUrl:"https://x/1", title:"iPhone 17", originalProductPrice:900, originalCurrency:"USD" },
  { provider:"ebay", sourceUrl:"https://x/2", title:"iPhone 17", originalProductPrice:910, originalCurrency:"USD" },
]);
assert.equal(unique.length, 2);

console.log("NAWAA provider tests passed");
