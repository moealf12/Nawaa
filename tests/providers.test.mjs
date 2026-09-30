import assert from "node:assert/strict";
import { assessOfferMatch, dedupeNormalizedOffers } from "../server/match.mjs";
import { normalizeCondition, parseMoney } from "../server/provider-utils.mjs";
import { parseJarirConstructorPayload, parseJarirSearchHtml } from "../server/providers/jarir.mjs";
import { parseNoonCatalogPayload } from "../server/providers/noon.mjs";

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

const noonFixture = {
  type: "catalog",
  nbHits: 1,
  hits: [{
    offer_code: "de2e8df30cb20f7e",
    catalog_sku: "N70211553V-1",
    sku: "N70211553V",
    brand: "Apple",
    name: "iPhone 17 256GB (Nano SIM + eSIM) Black 5G With FaceTime - International Version",
    plp_specifications: {
      "Screen Size": "6.3 in",
      "RAM Size": "8 GB",
      "Battery Size": "3692 mAh",
      "Secondary Camera Resolution": "18 MP"
    },
    price: 3798,
    sale_price: null,
    image_url: "https://example.com/noon.jpg",
    is_buyable: true,
    flags: ["fbn","free_delivery_eligible"],
    nudges: [{ text: "Free Delivery" }, { text: "Only 6 left in stock" }],
    low_stock_nudge_value: 6,
    pdp_url: "/iphone-17-256gb-nano-sim-esim-black-5g-with-facetime-international-version/N70211553V/p/?o=abc",
    store_name: "Seller One",
    partner_ratings_sellerlab: {
      positive_seller_rating: 97,
      partner_rating: 4.8
    },
    product_rating: { value: 4.6, count: 6419 }
  }]
};
const noonOffers = parseNoonCatalogPayload(noonFixture);
assert.equal(noonOffers.length, 1);
assert.equal(noonOffers[0].merchant, "noon");
assert.equal(noonOffers[0].productPrice, 3798);
assert.equal(noonOffers[0].shipping, 0);
assert.equal(noonOffers[0].availability, "in_stock");
assert.equal(noonOffers[0].specs.deviceType, "iPhone 17");
assert.equal(noonOffers[0].specs.storage.replace(" ",""), "256GB");
assert.equal(noonOffers[0].specs.color, "Black");
assert.equal(noonOffers[0].specs.sim, "Nano SIM + eSIM");
assert.equal(noonOffers[0].specs.network, "5G");
assert.equal(noonOffers[0].specs.ram, "8 GB");
assert.equal(noonOffers[0].specs.battery, "3692 mAh");
assert.equal(noonOffers[0].specs.regionVersion, "International Version");
assert.equal(noonOffers[0].sourceMeta.freeDelivery, true);
assert.equal(noonOffers[0].sourceMeta.fulfilledByNoon, true);
assert.equal(noonOffers[0].sourceMeta.lowStockCount, 6);
assert.equal(noonOffers[0].seller.name, "Seller One");

console.log("NAWAA provider tests passed");
