import test from "node:test";
import assert from "node:assert/strict";
import { assessOfferMatch } from "../server/match.mjs";
import { calculateComparableTotal, classifyOffer, buildOfferIntelligence, groupComparableOffers, buildVariantSelectorState } from "../src/search-core.mjs";
import { parseSharafAlgoliaPayload } from "../server/providers/sharafdg.mjs";
import { parseCarrefourSearchPayload } from "../server/providers/carrefour.mjs";
import { parseNoonCatalogPayload } from "../server/providers/noon.mjs";
import * as queries from "../src/search-query.mjs";

const iphone = { title: "Apple iPhone 17 Pro Max, 256 GB, Black", condition: "new" };

test('accessory line name and plural case type do not replace the explicit device model',()=>{
 const base={title:'iPhone 17 Series - Ultra Hybrid (Mag Fit) · iPhone 17 / Clear White / In Stock',productType:'Clear Cases',condition:'new'};
 assert.equal(queries.productCategory(base),'accessory');
 assert.deepEqual(queries.queryMatchReasons('iPhone 17 case',base),[]);
 const max={...base,title:'iPhone 17 Series - Ultra Hybrid (Mag Fit) · iPhone 17 Pro Max / Clear White / In Stock'};
 assert.ok(queries.queryMatchReasons('iPhone 17 case',max).includes('model_conflict'));
 const pro={...base,title:'iPhone 17 Series - Ultra Hybrid (Mag Fit) · iPhone 17 Pro / Clear White / In Stock'};
 assert.deepEqual(queries.queryMatchReasons('iPhone 17 Pro case',pro),[]);
 assert.ok(queries.queryMatchReasons('Galaxy S25 case',{...base,title:'Galaxy S25 Ultra Case'}).includes('model_conflict'));
 assert.ok(queries.queryMatchReasons('iPhone 17 case',{...base,title:'iPhone 17 Series - Ultra Hybrid (Mag Fit)'}).includes('query_mismatch'));
 assert.ok(queries.queryMatchReasons('iPhone 17 case',{...base,title:'iPhone 17 Case for iPhone 16'}).includes('model_conflict'));
 assert.equal(queries.productCategory({...base,productType:'Clear Covers',title:'iPhone 17 Cover'}),'accessory');
});
test('Series labels preserve qualified model conflicts and requested qualified variants',()=>{
 const offer={title:'iPhone 17 Case for iPhone 17 Pro Max Series',productType:'Clear Cases',condition:'new'};
 assert.ok(queries.queryMatchReasons('iPhone 17 case',offer).includes('model_conflict'));
 assert.deepEqual(queries.queryMatchReasons('iPhone 17 Pro Max case',{...offer,title:'iPhone 17 Pro Max Series Case'}),[]);
 assert.ok(queries.queryMatchReasons('Galaxy S25 case',{...offer,title:'Galaxy S25 Case for Galaxy S25 Ultra Series'}).includes('model_conflict'));
});
test('Galaxy accessory line separators do not fabricate an Ultra device suffix',()=>{
 const offer={title:'Galaxy S25 - Ultra Hybrid Case',productType:'Clear Cases',condition:'new'};
 assert.deepEqual(queries.queryMatchReasons('Galaxy S25 case',offer),[]);
 assert.ok(queries.queryMatchReasons('Galaxy S25 case',{...offer,title:'Galaxy S25 Ultra Case'}).includes('model_conflict'));
});

test("PS5 device search rejects games, controllers and accessories despite platform keywords", () => {
  for (const title of ["PS5 EA SPORTS FC 25", "Sony PS5 Dual Sense Edge Stick Module Black", "Grand Theft Auto V, PlayStation 5 (Games)", "Sony DualSense Charging Station for PlayStation 5", "Sony PS5 Media Remote", "Sony PS5 HD Camera", "PS5, Ghost of Yotei", "Sony Console Slim Cover PlayStation 5"])
    assert.equal(assessOfferMatch("ps5", {title,condition:"new"}).exactMatch,false,title);
  assert.equal(assessOfferMatch("ps5", {title:"Sony PlayStation 5 Slim Digital Console + Fortnite Game Bundle",condition:"new"}).exactMatch,true);
  assert.equal(assessOfferMatch("ps5", {title:"PS5, Console 1TB, Blu-Ray Disc",condition:"new"}).exactMatch,true);
});

// Captured from real candidate SSE on 2026-10-17; preserve original
// merchant identity/price, and never infer product kind from SAR 34.79.
const mcbazelHub = {
  title:"Mcbazel PS5 Console Hub USB2.0 5 Ports, High Speed Multiport Expansion Hub Data Transfer USB C Fast Charging Hub for PS5",
  merchant:"Amazon Saudi", providerMarket:"amazon-sa", currency:"SAR",
  productPrice:34.79, condition:"new",
  sourceUrl:"https://www.amazon.sa/-/en/Mcbazel-Multiport-Expansion-Transfer-Charging/dp/B0B1Q2NQGL/ref=sr_1_74",
  specs:{modelNumber:"B0B1Q2NQGL"},
};

test("real Amazon PS5 console USB expansion hub is an accessory, never an exact console",()=>{
  assert.equal(queries.describeProduct(mcbazelHub).kind,"accessory",
    "A console-compatible USB hub is not the console it connects to");
  assert.equal(queries.productCategory(mcbazelHub),"accessory");
  assert.equal(assessOfferMatch("PS5",mcbazelHub).exactMatch,false);
  assert.equal(assessOfferMatch("بلايستيشن 5",mcbazelHub).exactMatch,false);
  assert.equal(queries.parseSearchIntent("PS5 USB hub").kind,"accessory");
  assert.equal(assessOfferMatch("PS5 USB hub",mcbazelHub).exactMatch,true,
    "Accessory search must preserve this real, inexpensive offer");
  assert.equal(mcbazelHub.productPrice,34.79);
  assert.ok(mcbazelHub.sourceUrl.includes("B0B1Q2NQGL"));
});

test("hub matching adversarial cases preserve actual consoles and accessory intent",()=>{
  const accessories=[
    "PS5 Console Hub USB 2.0 Five Ports",
    "PS5 USB-C multiport expansion hub",
    "Sony PlayStation 5 USB docking station",
    "USB port expander for PlayStation 5 Console",
    "هب USB للبلايستيشن 5",
  ];
  for(const title of accessories){
    const offer={title,condition:"new",merchant:"Independent source"};
    assert.equal(queries.describeProduct(offer).kind,"accessory",title);
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,false,title);
  }
  for(const title of [
    "Sony PS5 Slim Disc Console 1TB",
    "Sony PS5 Digital Edition Console 825GB",
    "Sony PS5 Slim Console 1TB Bundle with USB Hub and Controller",
  ]) {
    const offer={title,condition:"new",productPrice:34.79,merchant:"Any merchant"};
    assert.equal(queries.describeProduct(offer).kind,"console",title);
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,true,title);
  }
  for(const merchant of ["Amazon Saudi","Jarir","eXtra"]){
    const offer={...mcbazelHub,merchant,productPrice:2499};
    assert.equal(queries.describeProduct(offer).kind,"accessory");
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,false);
  }
  assert.equal(queries.parseSearchIntent("هب USB للبلايستيشن 5").kind,"accessory");
});

// Real externally source-backed positive control:
// https://zgames.ae/ps5-digital-console-kgaming-bag-k10-headset-usb-hub-bundle
// PS5-5-AE includes an actual PS5 Digital Edition console and accessories.
// "with" variants below are deliberately synthetic adversarial rephrasings,
// not claims that ZGames published a different title.
test("console with included USB hub stays a console without literal bundle token",()=>{
  const sourceBacked={
    title:"PS5 Digital Console + KGaming Bag + K10 Headset + USB Hub Bundle",
    merchant:"ZGames UAE",sourceUrl:"https://zgames.ae/ps5-digital-console-kgaming-bag-k10-headset-usb-hub-bundle",
    currency:"AED",productPrice:2499,condition:"new",
    specs:{brand:"Sony",modelNumber:"ps5-5-ae"},
  };
  assert.equal(queries.describeProduct(sourceBacked).kind,"console");
  assert.equal(assessOfferMatch("PS5",sourceBacked).exactMatch,true);
  const consoleWithIncludedHub=[
    "Sony PS5 Slim Console with USB Hub",
    "PS5 Digital Console with a USB Hub",
    "Sony PlayStation 5 Console including USB Hub",
    "PS5 Console + USB Hub",
  ];
  for(const title of consoleWithIncludedHub){
    const offer={...sourceBacked,title,specs:{brand:"Sony",modelNumber:"CFI2116B01Y"}};
    assert.equal(queries.describeProduct(offer).kind,"console",title);
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,true,title);
  }
  // Query with explicit console + included peripheral should request a console;
  // an accessory-only query must continue to request the accessory.
  assert.equal(queries.parseSearchIntent("PS5 Console with USB Hub").kind,"console");
  assert.equal(queries.parseSearchIntent("PS5 USB Hub").kind,"accessory");
});

test("console plus included hub is not merged into the bare console offer for identical chassis SKU",()=>{
  // A manufacturer chassis SKU does not guarantee identical retail package
  // contents. These are deliberately synthetic same-SKU metamorphic inputs.
  const standalone={
    title:"Sony PS5 Slim Digital Console 825GB",
    condition:"new",merchant:"Merchant A",productPrice:2529,currency:"SAR",
    specs:{brand:"Sony",modelNumber:"CFI2116B01Y",storage:"825GB"},
  };
  const withHub={...standalone,title:"Sony PS5 Slim Digital Console with USB Hub 825GB",
    merchant:"Merchant B",productPrice:2729};
  assert.equal(queries.describeProduct(standalone).isBundle,false);
  assert.equal(queries.describeProduct(withHub).kind,"console");
  assert.equal(queries.describeProduct(withHub).isBundle,true,
    "Included peripheral changes the retail package even without the word bundle");
  const groups=groupComparableOffers([standalone,withHub]);
  assert.equal(groups.length,2,"Never claim equal retail bundles based only on console chassis SKU");
  assert.equal(groups.reduce((count,g)=>count+g.offers.length,0),2);
});

test("accessory bundles and compatibility-only console mentions cannot be promoted",()=>{
  const peripherals=[
    "PS5 Console Hub Bundle",
    "PS5 Console Hub with Charging Adapter",
    "PS5 USB Hub with Controller Charging Bundle",
    "PS5 Cooling Stand for Console with USB Hub",
    "USB Hub for PS5 Slim Console with Controller Charger",
  ];
  for(const title of peripherals){
    const offer={title,condition:"new",merchant:"Unspecified sample",productPrice:2799};
    assert.equal(queries.describeProduct(offer).kind,"accessory",title);
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,false,title);
  }
  const oldPersisted={...mcbazelHub,dataKind:"persisted",exactMatch:true,matchConfidence:1};
  const res=assessOfferMatch("PS5",oldPersisted);
  assert.equal(res.exactMatch,false,"persisted flags must be superseded by current classification");
  assert.equal(res.productKind,"accessory");
});


// E1: independently verified 2026-10-17 Sharaf DG UAE product pages.
// These are TWO actual merchant retail packages with same Sony chassis SKU,
// not synthetic merchant titles; neither URL lists a current price (out of stock).
const sharafHeadsetConsole = {
  title:"Sony PlayStation 5 Disc Console White – Middle East Version + PS5 PULSE 3D Wireless Headset + PS5 DualSense Wireless Controller",
  merchant:"Sharaf DG UAE",providerMarket:"sharafdg-ae",condition:"new",
  sourceUrl:"https://uae.sharafdg.com/product/sony-playstation-5-console-ps5-pulse-3d-wireless-headset-ps5-dualsense-wireless-controller/",
  specs:{brand:"Sony",modelNumber:"CFI1016A01",storage:"825GB",merchantItemNumber:"S100581518",regionVersion:"Middle East",deviceType:"Home Console"},
};
const sharafRemoteConsole = {
  ...sharafHeadsetConsole,
  title:"Sony PlayStation 5 Disc Console White – Middle East Version + PS5 PULSE 3D Wireless Headset + PS5 DualSense Wireless Controller + PS5 Media Remote",
  sourceUrl:"https://uae.sharafdg.com/product/sony-playstation-5-console-ps5-pulse-3d-wireless-headset-ps5-dualsense-wireless-controller-ps5-media-remote/",
  specs:{...sharafHeadsetConsole.specs,merchantItemNumber:"S100581519"},
};

test("actual Sharaf DG console-plus-accessories listings stay consoles without literal bundle",()=>{
  for(const offer of [sharafHeadsetConsole,sharafRemoteConsole]){
    const d=queries.describeProduct(offer);
    assert.equal(d.kind,"console",offer.sourceUrl);
    assert.equal(d.isBundle,true,"Actual merchant package includes PULSE headset and controller");
    const match=assessOfferMatch("PS5",offer);
    assert.equal(match.productKind,"console",offer.title);
    assert.equal(match.exactMatch,true,offer.title);
  }
  const groups=groupComparableOffers([sharafHeadsetConsole,sharafRemoteConsole].map(o=>({...o,...assessOfferMatch("PS5",o)})));
  assert.equal(groups.length,2,"Remote included in S100581519, absent in S100581518");
  assert.deepEqual(groups.map(x=>x.offers.length).sort(),[1,1]);
  assert.equal(sharafHeadsetConsole.specs.modelNumber,sharafRemoteConsole.specs.modelNumber);
});

test("authentic Noon cooling stand mentioning Sony PlayStation 5 console stays accessory",()=>{
  const stand={
    title:"XForm PS5 Stand and Cooling Station with Dual Controller Charging Station for Sony PlayStation 5 Console, PS5 Accessories Incl. Controller Charger, Cooling fan, Headset holder ( Fit PS5 FAT , SLIM ,SLIM PRO Versions) Black",
    merchant:"Noon Saudi",
    sourceUrl:"https://supermall.noon.com/saudi-en/ps5-stand-and-cooling-station-with-dual-controller-charging-station-for-sony-playstation-5-console-ps5-accessories-incl-controller-charger-cooling-fan-headset-holder-fit-ps5-fat-slim-slim-pro-versions-black/ZABDD93C1403C45E9B096Z/p/",
    condition:"new",
  };
  assert.equal(queries.describeProduct(stand).kind,"accessory");
  assert.equal(assessOfferMatch("PS5",stand).exactMatch,false);
});
test("live Jarir PS5 Disc Drive is not a 649 SAR console", () => {
  const separateDrives=[
    "Sony Disc Drive for PlayStation 5 Digital Edition Slim, White",
    "PS5 Pro Disc Drive Bundle",
    "Sony PlayStation 5 Optical Drive Replacement",
    "Sony Disk Drive for PS5 Slim",
  ];
  for(const title of separateDrives){
    const offer={title,condition:"new",productPrice:649,currency:"SAR",merchant:"Jarir"};
    assert.equal(queries.describeProduct(offer).kind,"accessory",title);
    assert.equal(queries.productCategory(offer),"accessory",title);
    const match=assessOfferMatch("ps5",offer);
    assert.equal(match.exactMatch,false,title);
    assert.ok(match.matchConfidence<0.35,title);
    assert.ok(queries.queryMatchReasons("ps5",offer).includes("query_mismatch"),title);
  }
  const separate={title:separateDrives[0],condition:"new"};
  assert.equal(queries.parseSearchIntent("PS5 disc drive").kind,"accessory");
  assert.equal(assessOfferMatch("PS5 disc drive",separate).exactMatch,true,
    "explicit accessory shoppers may still find the separate drive");
  for(const title of [
    "Sony PlayStation 5 Slim Console Blu-ray Disc Edition, 1 TB White",
    "Sony PlayStation 5 Slim Digital Console with Disc Drive 1TB",
  ]){
    const offer={title,condition:"new",productPrice:2500};
    assert.equal(queries.describeProduct(offer).kind,"console",title);
    assert.equal(assessOfferMatch("ps5",offer).exactMatch,true,title);
  }
  assert.equal(queries.parseSearchIntent("PS5 Console with Disc Drive").kind,"console");
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

test('same eBay listing across translated marketplaces is deduplicated',async()=>{
 const {dedupeNormalizedOffers}=await import('../server/match.mjs');
 const base={provider:'ebay',sourceListingId:'v1|123456789|0',sourceUrl:'https://www.ebay.co.uk/itm/123456789',title:'Shein Small Red Dress',originalProductPrice:3,originalCurrency:'GBP'};
 const offers=[
  base,
  {...base,providerMarket:'EBAY_FR',sourceUrl:'https://www.ebay.fr/itm/123456789',title:'Petite robe rouge Shein',originalProductPrice:3.5,originalCurrency:'EUR'},
  {...base,providerMarket:'EBAY_DE',sourceUrl:'https://www.ebay.de/itm/123456789',title:'Shein kleines rotes Kleid',originalProductPrice:4,originalCurrency:'EUR'},
 ];
 assert.equal(dedupeNormalizedOffers(offers).length,1);
});

test('translated dress titles remain clothing and match a Shein dress search',async()=>{
 const {productCategory,assessOfferMatch}=await import('../src/search-query.mjs');
 for(const title of [
  'Abito Shein piccolo rosso e bianco vita elasticizzata maniche corte',
  'Petite robe rouge et blanche Shein taille elastiquee manches courtes',
  'Shein kleines rot-weisses Kleid Gummizug kurze Armel',
 ]){
  const offer={title,condition:'new',specs:{brand:'Shein'}};
  assert.equal(productCategory(offer),'clothing');
  const match=assessOfferMatch('فستان شي ان',offer);
  assert.equal(match.productKind,'product');
  assert.notEqual(match.matchReason,'نوع المنتج يختلف عن المطلوب');
 }
});

test('accessory lookalikes do not become exact perfume or laptop matches',async()=>{
 const {productCategory,assessOfferMatch}=await import('../src/search-query.mjs');
 const atomizer={title:'Niceone Mini Perfume Atomizer Bottle - Blue',condition:'new',specs:{brand:'Niceone'}};
 assert.equal(productCategory(atomizer),'accessory');
 assert.equal(assessOfferMatch('نايس ون عطر',atomizer).exactMatch,false);

 const panel={title:'14 Laptop Screen for HP ProBook 640 Series Non-touch Panel',condition:'new',specs:{brand:'HP'}};
 assert.equal(productCategory(panel),'accessory');
 assert.equal(assessOfferMatch('لابتوب hp',panel).exactMatch,false);
});

test('marketplace title condition overrides optimistic API condition',async()=>{
 const {assessOfferMatch}=await import('../src/search-query.mjs');
 const offer={title:'iPhone 17 Black 256GB 97% Battery (B Grade)',condition:'new',specs:{brand:'Apple',storage:'256GB',color:'Black'}};
 const match=assessOfferMatch('ايفون 17 256 اسود',offer);
 assert.equal(match.exactMatch,false);
 assert.equal(match.matchReason,'حالة المنتج تختلف عن المطلوب');
});


// E1: source-backed candidate raw SSE, 2026-10-17, Amazon Saudi.
// Source identifier is an Amazon ASIN, not a claimed manufacturer SKU.
// SAR 799 was observed in that capture; NOT a verified current market price.
const wdBlackSn850Ps5Ssd = {
  title:"WD_BLACK 1TB SN850 NVMe SSD for PS5 Consoles Solid State Drive with Heatsink",
  merchant:"Amazon Saudi",providerMarket:"amazon-sa",currency:"SAR",
  productPrice:799,condition:"new",sourceIdentifier:"B0B4SQB1HY",
  sourceUrl:"https://www.amazon.sa/-/en/WD_BLACK-SN850-Consoles-Solid-Heatsink/dp/B0B4SQB1HY/ref=sr_1_140",
};

test("E1 Amazon WD_BLACK SN850 NVMe drive never becomes a PS5 console", () => {
  const source=wdBlackSn850Ps5Ssd;
  assert.equal(queries.describeProduct(source).kind,"accessory");
  assert.equal(queries.productCategory(source),"accessory");
  for(const query of ["PS5","بلايستيشن 5"]){
    const m=assessOfferMatch(query,source);
    assert.equal(m.exactMatch,false,query);
    assert.equal(m.productKind,"accessory",query);
    assert.notEqual(m.matchReason,"يطابق مواصفات بحثك",query);
  }
  assert.equal(queries.parseSearchIntent("PS5 SSD").kind,"accessory");
  assert.equal(assessOfferMatch("PS5 SSD",source).exactMatch,true);
  assert.equal(assessOfferMatch("SSD للبلايستيشن 5",source).exactMatch,true);
  assert.equal(source.merchant,"Amazon Saudi");
  assert.equal(source.currency,"SAR");
  assert.equal(source.productPrice,799);
  assert.equal(source.sourceIdentifier,"B0B4SQB1HY");
  assert.equal(source.sourceUrl,"https://www.amazon.sa/-/en/WD_BLACK-SN850-Consoles-Solid-Heatsink/dp/B0B4SQB1HY/ref=sr_1_140");
  const persisted={...source,exactMatch:true,matchConfidence:1,dataKind:"persisted"};
  assert.equal(assessOfferMatch("PS5",persisted).exactMatch,false,"stale exact flags are re-scored");
});

test("PS5 SSD search must not certify a non-storage PS5 USB hub",()=>{
  // RED in actual Chromium customer fixture: 2026-10-17 candidate emitted
  // both the E1 WD_BLACK SSD and unrelated Mcbazel USB hub as search cards.
  assert.equal(assessOfferMatch("PS5 SSD",mcbazelHub).exactMatch,false,
    "Shared PS5 and accessory category are insufficient for exact SSD subtype");
  assert.equal(assessOfferMatch("PS5 USB hub",wdBlackSn850Ps5Ssd).exactMatch,false);
  assert.ok(queries.queryMatchReasons("PS5 SSD",mcbazelHub).includes("query_mismatch"));
});

test("PS5 SSD kind withstands adversarial wording, merchants and price changes",()=>{
  const storageComponentTitles=[
    "WD_BLACK 1TB SN850 NVMe SSD for PS5 Consoles Solid State Drive with Heatsink",
    "1TB SSD for Sony PlayStation 5 Console",
    "PS5 SSD M.2 NVMe 2TB storage expansion drive",
    "External USB SSD for PS5 Console",
    "PS5 compatible NVMe solid state drive with heatsink",
    "هارد SSD للبلايستيشن 5",
  ];
  for(const title of storageComponentTitles){
    const offer={...wdBlackSn850Ps5Ssd,title};
    assert.equal(queries.describeProduct(offer).kind,"accessory",title);
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,false,title);
  }
  for(const merchant of ["Amazon Saudi","Jarir","Some Other Merchant"]){
    for(const price of [34.79,799,2999]){
      const offer={...wdBlackSn850Ps5Ssd,merchant,productPrice:price};
      assert.equal(queries.describeProduct(offer).kind,"accessory",merchant+"/"+price);
      assert.equal(assessOfferMatch("PS5",offer).exactMatch,false);
    }
  }
  const actualConsoles=[
    "Sony PS5 Slim Digital Console 1TB",
    "Sony PlayStation 5 Slim Disc Edition 1TB SSD",
    "Sony PS5 Slim Disc Console 1TB SSD included",
    "PS5 Console with 1TB SSD storage",
    "Sony PS5 Slim Digital Console 1TB Bundle with WD_BLACK SSD",
  ];
  for(const title of actualConsoles){
    const offer={title,condition:"new",productPrice:249,merchant:"Fixture"};
    assert.equal(queries.describeProduct(offer).kind,"console",title);
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,true,title);
  }
  const console={title:"Sony PS5 Slim Digital Console 1TB",merchant:"Fixture",condition:"new",currency:"SAR",productPrice:249};
  const groups=groupComparableOffers([console,wdBlackSn850Ps5Ssd].map(x=>({...x,...assessOfferMatch("PS5",x)})));
  assert.equal(groups.length,2,"SSD and PS5 console must never group as one physical product");
});


// v15.12 E1: real Saudi merchant pages checked on 2026-10-17.
// Listed prices are indexed page observations, not current market-price claims.
// No manufacturer SKU or exact observedAt is invented.
const noonPs5Heatsink = {
  title:"Heatsink for PS5 NVMe SSD",
  merchant:"GLOTRENDS",providerMarket:"noon-sa",currency:"SAR",productPrice:64,
  sourceIdentifier:"Z78E6BD03E487FC7156B1Z",
  sourceUrl:"https://www.noon.com/saudi-en/heatsink-for-ps5-nvme-ssd/Z78E6BD03E487FC7156B1Z/p/",
  condition:"new",
};
const noonExceforeHeatsink = {
  title:"M.2 Heatsink for PS5, NVMe SSD Aluminum Heatsink with 4 Thermal Pads for Playstation 5 Internal M.2 Gen4 NVME PCIE 4.0 SSD with Graphene and Silicone Thermal Pads",
  merchant:"ZARIO",providerMarket:"noon-sa",currency:"SAR",productPrice:156,
  sourceIdentifier:"Z93526034EEDFE197439CZ",
  sourceUrl:"https://www.noon.com/saudi-en/m-2-heatsink-for-ps5-nvme-ssd-aluminum-heatsink-with-4-thermal-pads-for-playstation-5-internal-m-2-gen4-nvme-pcie-4-0-ssd-with-graphene-and-silicone-thermal-pads/Z93526034EEDFE197439CZ/p/",
  specs:{modelNumber:"NA8292"},condition:"new",
};
const geekayWdBlackSn850p = {
  title:"WD_BLACK 1TB SN850P NVMe SSD with Heatsink",
  merchant:"Geekay Saudi",providerMarket:"geekay-sa",currency:"SAR",productPrice:1049,
  sourceUrl:"https://www.geekay.com/saudi_en/sandisk-wd-black-sn850p-nvme-ssd-with-heatsink",
  specs:{brand:"Western Digital",storage:"1TB"},condition:"new",
};
const jarirRealDigConsole = {
  title:"Sony PlayStation 5 Slim (DIG) 825 GB SSD, White",
  merchant:"Jarir",providerMarket:"jarir-sa",currency:"SAR",productPrice:2529,
  sourceIdentifier:"668751",
  sourceUrl:"https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html",
  specs:{brand:"Sony",modelNumber:"CFI2116B01Y",storage:"825GB"},condition:"new",
};

test("v15.12 E1 real Noon PS5 heatsinks are not exact complete SSDs",()=>{
  for(const offer of [noonPs5Heatsink,noonExceforeHeatsink]){
    assert.equal(queries.describeProduct(offer).kind,"accessory",offer.sourceUrl);
    assert.equal(assessOfferMatch("PS5",offer).exactMatch,false,offer.title);
    assert.equal(assessOfferMatch("PS5 SSD",offer).exactMatch,false,
      "heatsink-only must never be certified as an SSD "+offer.title);
    assert.ok(assessOfferMatch("PS5 SSD heatsink",offer).exactMatch,
      "explicit heatsink shopper should still find the accessory "+offer.title);
    assert.equal(offer.currency,"SAR");
    assert.ok(offer.sourceUrl.includes(offer.sourceIdentifier));
  }
  assert.equal(noonPs5Heatsink.productPrice,64);
  assert.equal(noonExceforeHeatsink.productPrice,156);
});

test("v15.12 E1 real complete SSD and authentic PS5 console remain discoverable",()=>{
  assert.equal(queries.productCategory(geekayWdBlackSn850p),"accessory",
    "Non-gaming generic SSD is categorized by productCategory, not gaming-only describeProduct.kind");
  assert.equal(assessOfferMatch("PS5",geekayWdBlackSn850p).exactMatch,false);
  // The E1 title has no PS5 word; do not require a query-specific exactMatch
  // based on brand claims or the compatibility description not in title.
  assert.equal(queries.describeProduct(jarirRealDigConsole).kind,"console");
  assert.equal(assessOfferMatch("PS5",jarirRealDigConsole).exactMatch,true);
  assert.equal(jarirRealDigConsole.specs.modelNumber,"CFI2116B01Y");
  assert.equal(jarirRealDigConsole.productPrice,2529);
});

test("v15.12 E2 source-derived SSD subcomponents and abbreviations keep physical identity",()=>{
  const derivedFromNoon=[
    {...noonPs5Heatsink,title:"PS5 SSD Heatsink for NVMe M.2 storage"},
    {...noonPs5Heatsink,title:"M.2 SSD heatsink only for PS5"},
    {...noonPs5Heatsink,title:"PS5 NVMe SSD cooling plate replacement"},
    {...noonPs5Heatsink,title:"PS5 NVMe SSD enclosure case"},
  ];
  for(const offer of derivedFromNoon){
    assert.equal(assessOfferMatch("PS5 SSD",offer).exactMatch,false,offer.title);
  }
  const shortenedRealConsole={...jarirRealDigConsole,
    title:"Sony PlayStation 5 Slim 825 GB SSD, White"};
  assert.equal(queries.describeProduct(shortenedRealConsole).kind,"console",
    "manufacturer-backed actual PS5 must remain console if seller drops DIG");
  assert.equal(assessOfferMatch("PS5",shortenedRealConsole).exactMatch,true);
  assert.equal(assessOfferMatch("PS5 SSD",shortenedRealConsole).exactMatch,false,
    "embedded console storage does not turn the console into a standalone SSD");
  const unknownBrand={...noonPs5Heatsink,merchant:"Unrelated Merchant",productPrice:5000};
  assert.equal(assessOfferMatch("PS5 SSD",unknownBrand).exactMatch,false);
});

