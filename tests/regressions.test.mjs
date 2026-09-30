import test from "node:test";
import assert from "node:assert/strict";
import { assessOfferMatch } from "../server/match.mjs";
import { calculateComparableTotal, classifyOffer, buildOfferIntelligence } from "../src/search-core.mjs";
import { parseSharafAlgoliaPayload } from "../server/providers/sharafdg.mjs";
import { parseCarrefourSearchPayload } from "../server/providers/carrefour.mjs";
import { parseNoonCatalogPayload } from "../server/providers/noon.mjs";
import * as queries from "../src/search-query.mjs";

const iphone = { title: "Apple iPhone 17 Pro Max, 256 GB, Black", condition: "new" };

test("related-only and single-offer groups render without a missing price baseline", () => {
  const offer = { productPrice: 3999, condition: "new", availability: "in_stock", canShipToSaudi: true,
    exactMatch: false, matchConfidence: 0.7 };
  assert.doesNotThrow(() => buildOfferIntelligence({ offers: [offer] }));
  assert.doesNotThrow(() => buildOfferIntelligence({ offers: [{ ...offer, exactMatch: true, matchConfidence: 1 }] }));
});

test("Arabic model, variant, color and storage match an English merchant title", () => {
  assert.equal(assessOfferMatch("آيفون ١٧ برو ماكس ٢٥٦ جيجا أسود", iphone).exactMatch, true);
});

test("Arabic and English base-model requests reject unrequested Pro Max", () => {
  assert.equal(assessOfferMatch("ايفون 17", iphone).exactMatch, false);
  assert.equal(assessOfferMatch("iPhone 17", iphone).exactMatch, false);
});

test("model and storage numbers must match whole tokens", () => {
  assert.equal(assessOfferMatch("iPhone 17", { title: "Apple iPhone 170 256GB", condition: "new" }).exactMatch, false);
  assert.equal(assessOfferMatch("iPhone 17 256GB", { title: "Apple iPhone 17 1256GB", condition: "new" }).exactMatch, false);
});

test("Arabic accessory intent matches accessories but a device query excludes them", () => {
  const offer = { title: "Case Cover for Apple iPhone 17", condition: "new" };
  assert.equal(assessOfferMatch("كفر ايفون ١٧", offer).exactMatch, true);
  assert.equal(assessOfferMatch("ايفون ١٧", offer).exactMatch, false);
});

const completeCosts = { shipping: 20, importCost: 0, tax: 0, mandatoryFees: 0 };

test("Sharaf DG sale price is not discounted twice when delivered costs become known", () => {
  const [offer] = parseSharafAlgoliaPayload({ hits: [{
    objectID: "123", post_title: "Apple iPhone 17 256GB Black", sale_price: "3799", regular_price: "3999",
    permalink: "https://saudi.sharafdg.com/product/iphone-17/", stock_status: "instock",
  }] });
  assert.equal(calculateComparableTotal({ ...offer, ...completeCosts }), 3819);
});

test("Carrefour final price is not discounted twice", () => {
  const [offer] = parseCarrefourSearchPayload({ sections: [{ uid: "master-product-card", componentDTO: {
    additionalAttributes: { productId: "754835", productName: "Apple iPhone 17 256GB Black", sellingPrice: 3999,
      markedPrice: 4299, currency: "SAR", productUrl: "/mafsau/en/smartphones/iphone/p/754835", stock: { value: 1 } },
    productCardComponents: [],
  } }] });
  assert.equal(calculateComparableTotal({ ...offer, ...completeCosts }), 4019);
});

test("an additional confirmed discount still reduces the total once", () => {
  assert.equal(calculateComparableTotal({ productPrice: 100, ...completeCosts, discount: 10 }), 110);
});

test("Noon sale price is not discounted twice before provider activation", () => {
  const [offer] = parseNoonCatalogPayload({ hits: [{ sku: "N123", name: "Apple iPhone 17 256GB Black", price: 3999,
    sale_price: 3799, is_buyable: true, pdp_url: "/iphone-17/N123/p/" }] });
  assert.equal(calculateComparableTotal({ ...offer, ...completeCosts }), 3819);
});

test("unknown delivery or availability cannot produce a confirmed offer", () => {
  const offer = { productPrice: 100, ...completeCosts, discount: 0, condition: "new", exactMatch: true,
    matchConfidence: 1, priceConfidence: "confirmed", availability: "in_stock", canShipToSaudi: true };
  assert.equal(classifyOffer({ ...offer, canShipToSaudi: null }), "incomplete");
  assert.equal(classifyOffer({ ...offer, availability: "unknown" }), "incomplete");
  assert.equal(classifyOffer(offer), "confirmed");
});

test("a product URL yields a bounded model search without merchant marketing text", () => {
  assert.equal(queries.buildComparisonQuery?.({ title:
    "Apple iPhone 17 (256GB) – Black – Middle East Version with FaceTime | Shop Now",
  }), "iphone 17 256gb black");
  assert.equal(queries.buildComparisonQuery?.({ title: "AirPods Pro 2 USB-C | Buy Online" }), "airpods pro 2 usb c");
  assert.equal(queries.buildComparisonQuery?.({ title: "a".repeat(240) }).length, 180);
});

test("URL comparison keeps the source offer and labels conflicting SKUs as related", () => {
  const source = { title: "Apple iPhone 17 256GB Black", sourceUrl: "https://shop.example/phone",
    condition: "new", specs: { brand: "Apple", deviceType: "iPhone 17", storage: "256GB", color: "Black", modelNumber: "MG674AH/A" } };
  const offers = queries.mergeComparisonOffers?.(source, [
    { ...source, sourceUrl: "https://jarir.example/phone", specs: { ...source.specs, modelNumber: "MG674AHA" } },
    { ...source, sourceUrl: "https://shop.example/phone?campaign=test" },
    { ...source, sourceUrl: "https://other.example/phone", specs: { ...source.specs, modelNumber: "MG674LL/A" } },
    { title: "Apple iPhone 17 Pro 256GB Black", sourceUrl: "https://shop.example/pro", condition: "new" },
  ]);
  assert.equal(offers?.length, 4);
  assert.equal(offers?.[0].sourceUrl, source.sourceUrl);
  assert.equal(offers?.[1].exactMatch, true);
  assert.equal(offers?.[2].exactMatch, false);
  assert.equal(offers?.[3].exactMatch, false);
});
