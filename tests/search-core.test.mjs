import assert from "node:assert/strict";
import {
  calculateComparableTotal,
  classifyOffer,
  findBestProduct,
  productMatchScore,
  rankOffers,
  offerVariantKey,
  offerVariantFamilyKey,
  groupComparableOffers,
  groupVariantFamilies,
  buildVariantSelectorState,
  buildCanonicalProductProfile,
  buildOfferIntelligence,
  DEMO_CATALOG,
} from "../src/search-core.mjs";
import { WORLD_SOURCE_REGISTRY, sourceCoverageSummary } from "../src/source-registry.mjs";

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

const airpods = DEMO_CATALOG.find((product) => product.id === "airpods-pro-2-usbc");
assert.ok(productMatchScore("ايربودز برو 2 usb c", airpods) >= 0.75);
assert.equal(findBestProduct("MTJV3", DEMO_CATALOG)?.product.id, "airpods-pro-2-usbc");
assert.equal(findBestProduct("something totally unrelated", DEMO_CATALOG), null);

console.log("NAWAA search-core tests passed");


const coverage = sourceCoverageSummary();
assert.ok(coverage.sources >= 40);
assert.ok(coverage.countries >= 20);
assert.ok(WORLD_SOURCE_REGISTRY.every((source) => /^[A-Z]{2}$/.test(source.countryCode)));
assert.equal(new Set(WORLD_SOURCE_REGISTRY.map((source) => source.id)).size, WORLD_SOURCE_REGISTRY.length);

assert.equal(findBestProduct("iPhone 17", DEMO_CATALOG)?.product.id, "iphone-17");
assert.equal(findBestProduct("ايفون 17", DEMO_CATALOG)?.product.id, "iphone-17");


const groupedVariants = groupComparableOffers([
  {
    merchant:"eXtra",
    title:"Apple iPhone 17, 5G, 6.3 inch 256GB, Black",
    specs:{brand:"APPLE",deviceType:"IPHONE 17",storage:"256 GB",color:"Black"},
    productPrice:3999,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"in_stock",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  },
  {
    merchant:"Jarir",
    title:"Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
    specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256GB",color:"Black"},
    productPrice:4299,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"unknown",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  },
  {
    merchant:"Jarir",
    title:"Apple iPhone 17 Pro, 256 GB, Black, 5G",
    specs:{brand:"Apple",deviceType:"iPhone 17 Pro",storage:"256 GB",color:"Black"},
    productPrice:4999,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"unknown",canShipToSaudi:true,exactMatch:false,matchConfidence:.82,priceConfidence:"incomplete"
  }
]);
assert.equal(groupedVariants.length, 2);
assert.equal(groupedVariants[0].offers.length, 2);
assert.equal(groupedVariants[0].bestOffer.merchant, "eXtra");
assert.equal(groupedVariants[0].bestValue, 3999);
assert.equal(groupedVariants[0].savingsToNext, 300);
assert.equal(groupedVariants[0].priceBasis, "advertised_price");
assert.notEqual(
  offerVariantKey(groupedVariants[0].offers[0]),
  offerVariantKey(groupedVariants[1].offers[0])
);


const groupedWithSecondColor = groupComparableOffers([
  ...groupedVariants.flatMap((group) => group.offers),
  {
    merchant:"eXtra",
    title:"Apple iPhone 17, 5G, 6.3 inch 256GB, White",
    specs:{brand:"APPLE",deviceType:"IPHONE 17",storage:"256 GB",color:"White"},
    productPrice:3999,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"in_stock",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  },
  {
    merchant:"Jarir",
    title:"Apple iPhone 17, 256 GB, White, 5G, Apple A19",
    specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256 GB",color:"White"},
    productPrice:4299,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"unknown",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  }
]);
const variantFamilies = groupVariantFamilies(groupedWithSecondColor.filter((group) => group.bestOffer?.exactMatch));
assert.equal(variantFamilies.length, 1);
assert.equal(variantFamilies[0].variants.length, 2);
assert.equal(variantFamilies[0].merchantCount, 2);
assert.equal(
  offerVariantFamilyKey(variantFamilies[0].variants[0].bestOffer),
  offerVariantFamilyKey(variantFamilies[0].variants[1].bestOffer)
);
assert.notEqual(
  offerVariantKey(variantFamilies[0].variants[0].bestOffer),
  offerVariantKey(variantFamilies[0].variants[1].bestOffer)
);


const selectorGroups = groupComparableOffers([
  {
    merchant:"eXtra",
    title:"Apple iPhone 17, 5G, 6.3 inch 256GB, Black",
    specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256 GB",color:"Black",ram:"8GB",processor:"A19 Bionic",operatingSystem:"iOS"},
    productPrice:3999,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"in_stock",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  },
  {
    merchant:"Jarir",
    title:"Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
    specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256GB",color:"Black",processor:"Apple A19",screenType:"Super Retina XDR Display",operatingSystem:"iOS 26",sim:"Dual eSIM"},
    productPrice:4299,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"unknown",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  },
  {
    merchant:"eXtra",
    title:"Apple iPhone 17 Pro, 5G, 6.3 inch 256GB, Black",
    specs:{brand:"Apple",deviceType:"iPhone 17 Pro",storage:"256 GB",color:"Black"},
    productPrice:4399,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"in_stock",canShipToSaudi:true,exactMatch:false,matchConfidence:.82,priceConfidence:"incomplete"
  },
  {
    merchant:"Jarir",
    title:"Renewed Apple iPhone 17, 256 GB, Black, 5G",
    specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256 GB",color:"Black"},
    productPrice:3299,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"renewed",availability:"unknown",canShipToSaudi:true,exactMatch:false,matchConfidence:.85,priceConfidence:"incomplete"
  }
]);

const selectorState = buildVariantSelectorState(selectorGroups, {});
assert.equal(selectorState.labels.modelLabel, "iPhone 17");
assert.equal(selectorState.labels.storageKey, "256gb");
assert.equal(selectorState.labels.colorKey, "black");
assert.equal(selectorState.labels.conditionKey, "new");
assert.ok(selectorState.options.models.some((option) => option.label === "iPhone 17 Pro"));
assert.ok(selectorState.options.conditions.some((option) => option.key === "renewed"));

const proSelectorState = buildVariantSelectorState(selectorGroups, { modelKey:"iphone 17 pro" });
assert.equal(proSelectorState.labels.modelLabel, "iPhone 17 Pro");
assert.equal(proSelectorState.selectedGroup.bestOffer.merchant, "eXtra");

const canonical = buildCanonicalProductProfile(selectorState.selectedGroup.offers);
assert.equal(canonical.brand.value, "Apple");
assert.equal(canonical.storage.value.replace(" ",""), "256GB");
assert.equal(canonical.ram.value, "8GB");
assert.equal(canonical.screenType.value, "Super Retina XDR Display");
assert.equal(canonical.sim.value, "Dual eSIM");
assert.equal(canonical.operatingSystem.value, "iOS 26");
assert.equal(canonical.operatingSystem.conflict, true);
assert.ok(canonical.operatingSystem.alternatives.some((item) => item.value === "iOS"));


const intelligenceGroup = groupComparableOffers([
  {
    merchant:"eXtra",
    title:"Apple iPhone 17, 5G, 6.3 inch 256GB, Black",
    specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256 GB",color:"Black"},
    sourceMeta:{jeddahInStock:true,homeDeliveryEnabled:true,collectFromStoreEnabled:true},
    productPrice:3999,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"in_stock",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  },
  {
    merchant:"Jarir",
    title:"Apple iPhone 17, 256 GB, Black, 5G, Apple A19",
    specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256 GB",color:"Black"},
    productPrice:4299,shipping:null,importCost:0,tax:null,mandatoryFees:0,discount:0,
    condition:"new",availability:"unknown",canShipToSaudi:true,exactMatch:true,matchConfidence:1,priceConfidence:"incomplete"
  }
])[0];

const intelligence = buildOfferIntelligence(intelligenceGroup);
assert.equal(intelligence.baselineOffer.merchant, "eXtra");
assert.equal(intelligence.baselineValue, 3999);
assert.equal(intelligence.priceBasis, "advertised_price");
assert.equal(intelligence.rows[0].delta, 0);
assert.equal(intelligence.rows[1].delta, 300);
assert.equal(intelligence.rows[1].deltaPercent, 7.5);
assert.ok(intelligence.rows[0].badges.includes("متوفر في جدة"));
assert.ok(intelligence.rows[0].badges.includes("توصيل منزلي"));
assert.ok(intelligence.rows[1].warnings.some((item) => item.includes("التوفر التفصيلي")));
assert.ok(intelligence.insights.some((item) =>
  item.type === "price" &&
  item.text.includes("eXtra") &&
  item.text.includes("Jarir")
));
assert.ok(intelligence.insights.some((item) => item.type === "availability" && item.text.includes("eXtra")));
assert.ok(intelligence.insights.some((item) => item.type === "cost"));
