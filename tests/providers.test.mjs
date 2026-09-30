import assert from "node:assert/strict";
import { assessOfferMatch, dedupeNormalizedOffers } from "../server/match.mjs";
import { normalizeCondition, parseMoney } from "../server/provider-utils.mjs";
import { parseJarirConstructorPayload, parseJarirSearchHtml } from "../server/providers/jarir.mjs";

assert.equal(normalizeCondition("Brand New"), "new");
assert.equal(normalizeCondition("Open Box"), "open_box");
assert.equal(parseMoney("$1,299.99"), 1299.99);

const iphone = assessOfferMatch("iPhone 17 256GB", {
  title: "Apple iPhone 17 256GB Black Factory Unlocked",
  condition: "new",
});
assert.equal(iphone.exactMatch, true);
assert.ok(iphone.matchConfidence >= 0.92);

const jarirExact = assessOfferMatch("iPhone 17 256GB", {
  title: "Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
  condition: "new",
});
assert.equal(jarirExact.exactMatch, true);
assert.equal(jarirExact.matchConfidence, 1);

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

const jarirFixture = `
<div class="product-tile__item--spacer d-inline-flex" data-cnstrc-item-id="666789" data-cnstrc-item-name="Apple iPhone 17, 256 GB, Lavender, 5G, Apple A19" data-cnstrc-item-price="4299">
  <a href="https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666789.html" data-product-id="666789"></a>
  <img src="https://example.com/666789.jpg" alt="Apple iPhone 17, 256 GB, Lavender, 5G, Apple A19">
  <button>Add to Cart</button>
</div>
<div class="product-tile__item--spacer d-inline-flex" data-cnstrc-item-id="673746" data-cnstrc-item-name="Renewed Grade A Apple iPhone 17, 256 GB, White, 5G" data-cnstrc-item-price="3199">
  <a href="https://www.jarir.com/sa-en/apple-iphone-17-renewed-smartphones-673746.html" data-product-id="673746"></a>
  <img src="https://example.com/673746.jpg" alt="Renewed Grade A Apple iPhone 17, 256 GB, White, 5G">
</div>`;
const jarirOffers = parseJarirSearchHtml(jarirFixture);
assert.equal(jarirOffers.length, 2);
assert.equal(jarirOffers[0].merchant, "Jarir");
assert.equal(jarirOffers[0].productPrice, 4299);
assert.equal(jarirOffers[0].availability, "in_stock");
assert.equal(jarirOffers[0].specs.storage, "256 GB");
assert.equal(jarirOffers[0].specs.color, "Lavender");
assert.equal(jarirOffers[0].specs.network, "5G");
assert.equal(jarirOffers[0].specs.processor, "Apple A19");
assert.equal(jarirOffers[1].condition, "renewed");

const jarirConstructorFixture = {
  response: {
    results: [{
      value: "Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
      data: {
        id: "666784",
        url: "apple-iphone-17-smartphones-666784.html",
        price: 4299,
        image_url: "https://example.com/666784.jpg",
        metadata: {
          name: "Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
          brand: "Apple",
          seri: "Apple iPhone 17",
          model: "iPhone 17",
          ptyp: "Smartphone",
          tsca: "256 GB",
          colo: "Black",
          scsz: "6.3\"",
          scty: "Super Retina XDR Display",
          opsy: "iOS 26",
          nsim: "Dual eSIM (eSIM/eSIM)",
          cars: "Rear: 48 MP + 48 MP/Front: 18 MP",
          mpn: "MG674AHA",
          bar_code1: "195950643008",
          productcode_description: "Smartphones"
        }
      }
    }]
  }
};
const jarirConstructorOffers = parseJarirConstructorPayload(jarirConstructorFixture);
assert.equal(jarirConstructorOffers.length, 1);
assert.equal(jarirConstructorOffers[0].productPrice, 4299);
assert.equal(jarirConstructorOffers[0].specs.color, "Black");
assert.equal(jarirConstructorOffers[0].specs.storage, "256 GB");
assert.equal(jarirConstructorOffers[0].specs.screenSize, '6.3"');
assert.equal(jarirConstructorOffers[0].specs.rearCamera, "48 MP + 48 MP");
assert.equal(jarirConstructorOffers[0].specs.frontCamera, "18 MP");
assert.equal(jarirConstructorOffers[0].specs.modelNumber, "MG674AHA");

console.log("NAWAA provider tests passed");
