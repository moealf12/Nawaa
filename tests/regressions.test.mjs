import test from "node:test";
import assert from "node:assert/strict";
import { assessOfferMatch } from "../server/match.mjs";
import { calculateComparableTotal, classifyOffer, buildOfferIntelligence, groupComparableOffers, buildVariantSelectorState } from "../src/search-core.mjs";
import { parseSharafAlgoliaPayload } from "../server/providers/sharafdg.mjs";
import { parseCarrefourSearchPayload } from "../server/providers/carrefour.mjs";
import { parseNoonCatalogPayload } from "../server/providers/noon.mjs";
import * as queries from "../src/search-query.mjs";

const iphone = { title: "Apple iPhone 17 Pro Max, 256 GB, Black", condition: "new" };

test("PS5 device search rejects games, controllers and accessories despite platform keywords", () => {
  for (const title of ["PS5 EA SPORTS FC 25", "Sony PS5 Dual Sense Edge Stick Module Black", "Grand Theft Auto V, PlayStation 5 (Games)", "Sony DualSense Charging Station for PlayStation 5", "Sony PS5 Media Remote", "Sony PS5 HD Camera", "PS5, Ghost of Yotei", "Sony Console Slim Cover PlayStation 5"])
    assert.equal(assessOfferMatch("ps5", {title,condition:"new"}).exactMatch,false,title);
  assert.equal(assessOfferMatch("ps5", {title:"Sony PlayStation 5 Slim Digital Console + Fortnite Game Bundle",condition:"new"}).exactMatch,true);
  assert.equal(assessOfferMatch("ps5", {title:"PS5, Console 1TB, Blu-Ray Disc",condition:"new"}).exactMatch,true);
});

test("explicit game and controller searches retain their intended product type", () => {
  assert.equal(assessOfferMatch("ps5 العاب", {title:"PS5 EA SPORTS FC 25",condition:"new"}).exactMatch,true);
  assert.equal(assessOfferMatch("ps5 العاب", {title:"Sony PS5 Slim Console",condition:"new"}).exactMatch,false);
  assert.equal(assessOfferMatch("يد ps5", {title:"Sony DualSense Controller for PlayStation 5",condition:"new"}).exactMatch,true);
});

test("console display offers meaningful choices without treating casing colors as device variants", () => {
  assert.equal(typeof queries.describeProduct, "function");
  const description = queries.describeProduct({title:"Sony PlayStation 5 Console (Disc Version) 1TB White",specs:{color:"White",storage:"1TB"}});
  assert.equal(description.kind,"console");
  assert.equal(description.edition,"disc");
  assert.equal(description.storage,"1tb");
});

test("same console SKU groups across merchant wording without mixing digital, disc or bundles", () => {
  const base = {condition:"new",exactMatch:true,matchConfidence:1,productPrice:2000,availability:"in_stock",canShipToSaudi:true};
  const offers = [
    {...base,merchant:"A",title:"PS5, Digital Edition 825GB",specs:{brand:"Sony",modelNumber:"CFI-2116B01Y"}},
    {...base,merchant:"B",title:"Sony PlayStation 5 Slim (DIG) 825 GB SSD, White",specs:{brand:"Sony",modelNumber:"CFI2116B01Y",color:"White",storage:"Sony PlayStation 5 Slim (DIG) 825 GB SSD",deviceType:"PlayStation 5 Slim (DIG)"}},
    {...base,merchant:"C",title:"PS5 Console 1TB Blu-Ray Disc",specs:{brand:"Sony",modelNumber:"CFI2116A01Y"}},
    {...base,merchant:"D",title:"PS5 Digital Console Fortnite Game Bundle",specs:{brand:"Sony",modelNumber:"CFI2116B01Y"}},
  ];
  const groups=groupComparableOffers(offers);
  assert.equal(groups.length,3);
  assert.equal(groups.find(group=>group.offers.some(o=>o.merchant==="A")).merchantCount,2);
});

test("available console variants precede cheaper unavailable variants in cards and default selection", () => {
  const base={condition:"new",exactMatch:true,matchConfidence:1,canShipToSaudi:true};
  const groups=groupComparableOffers([
    {...base,merchant:"A",title:"PS5 Slim Digital Console",productPrice:1500,availability:"out_of_stock",specs:{modelNumber:"CFI2016B01Y"}},
    {...base,merchant:"B",title:"PS5 Slim Disc Console",productPrice:2000,availability:"in_stock",specs:{modelNumber:"CFI2016A01Y"}},
  ]);
  assert.equal(groups[0].bestOffer.merchant,"B");
  assert.equal(buildVariantSelectorState(groups).selectedGroup.bestOffer.merchant,"B");
});

test("Sharaf product images supplied as a string remain a complete image URL", () => {
  const result = parseSharafAlgoliaPayload({hits:[{sku:"CFI2016B01Y",post_title:"Sony PS5 Slim Console",price:2000,url:"/product/ps5/",images:"https://cdn.example.com/ps5.jpg"}]});
  assert.equal(result[0].image,"https://cdn.example.com/ps5.jpg");
});

test("natural Arabic search preserves model constraints and removes conversational filler", () => {
  assert.equal(queries.normalizeSearchQuery("ابغى ايفون ١٧ برو ٢٥٦جيجا اسود بأفضل سعر"), "iphone 17 pro 256gb black");
  assert.equal(queries.normalizeSearchQuery("ايفون١٧ ٢٥٦ اسود"), "iphone 17 256gb black");
  assert.equal(queries.normalizeSearchQuery("ايربودز برو٢"), "airpods pro 2");
});

test("search intent retains requested capacity, color and refurbished condition", () => {
  assert.equal(typeof queries.parseSearchIntent, "function");
  const intent = queries.parseSearchIntent("ايفون 17 512 جيجا ابيض مجدد");
  assert.equal(intent.storage, "512gb");
  assert.equal(intent.color, "white");
  assert.equal(intent.condition, "refurbished");
  assert.equal(assessOfferMatch("ايفون 17 مجدد", {title:"Apple iPhone 17",condition:"refurbished"}).exactMatch,true);
  assert.equal(assessOfferMatch("ايفون 17 مجدد", {title:"Apple iPhone 17",condition:"new"}).exactMatch,false);
});

test("match explanation identifies requested constraints missing from an offer", () => {
  const result = assessOfferMatch("ايفون 17 512 اسود", {title:"Apple iPhone 17 256GB White",condition:"new"});
  assert.ok(result.missingTerms.includes("black"));
  assert.ok(result.matchReason);
});

test("merchant ordinal generations match AirPods 2 without accepting generation 3 or a case", () => {
  assert.equal(assessOfferMatch("ايربودز برو٢", {title:"Apple AirPods Pro 2nd gen with MagSafe Charging, White",condition:"new"}).exactMatch,true);
  assert.equal(assessOfferMatch("airpods pro 2", {title:"Apple AirPods Pro 3rd gen",condition:"new"}).exactMatch,false);
  assert.equal(assessOfferMatch("airpods pro 2", {title:"Earbuds Case for Apple AirPods Pro 2nd Gen",condition:"new"}).exactMatch,false);
});

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
