import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessOfferMatch,createOfferMatchAssessor,normalizeSearchQuery} from "../src/search-query.mjs";

const candidates=[
  ["Apple iPhone 17 256GB Black","phone","Apple","256GB","new"],
  ["Apple iPhone 17 Pro 256GB Black","phone","Apple","256GB","new"],
  ["Apple iPhone 17 512GB White","phone","Apple","512GB","new"],
  ["Apple iPhone 17 256GB Refurbished","phone","Apple","256GB","refurbished"],
  ["Samsung Galaxy S25 256GB","phone","Samsung","256GB","new"],
  ["Samsung Galaxy S25 Ultra 512GB","phone","Samsung","512GB","new"],
  ["Sony PlayStation 5 PS5 Slim Console Disc Edition","console","Sony","", "new"],
  ["Sony PS5 Pro Console","console","Sony","","new"],
  ["Sony PS5 Disc Drive for Console","accessory","Sony","","new"],
  ["PS5 Vertical Stand for PlayStation 5","accessory","Sony","","new"],
  ["PS5 Controller DualSense Charging Station","accessory","Sony","","new"],
  ["Sony PlayStation 5 Console with Extra DualSense Controller Bundle","console","Sony","","new"],
  ["JBL Wireless Bluetooth Headphones","headphones","JBL","","new"],
  ["JBL Portable Bluetooth Speaker","speaker","JBL","","new"],
  ["HP Pavilion 15 Laptop 16GB RAM 512GB SSD","laptop","HP","512GB","new"],
  ["HP Laptop SSD Upgrade 512GB","accessory","HP","512GB","new"],
  ["Sony Wireless Bluetooth Earbuds","audio","Sony","","new"],
];
const queries=[
  "iPhone","iPhone 17","iPhone 17 256GB","آيفون 17","آيفون 17 برو",
  "Samsung Galaxy S25","Samsung Galaxy S25 Ultra",
  "PS5","PS5 Pro","PS5 Slim Disc","PS5 controller","PS5 console with controller",
  "بلايستيشن 5 ديجيتال","سماعات بلوتوث","bluetooth headphones",
  "bluetooth speaker","HP laptop","لابتوب اتش بي","HP laptop SSD","laptop",
  "سوني","Apple","JBL",
];
function toOffer([title,productType,brand,storage,condition],index){
  return {
    title, productType, brand,condition,provider:index%2?"extra-unbxd":"jarir-direct",
    merchant:index%2?"eXtra":"Jarir",
    sourceUrl:"https://example.com/p/"+index+"/"+
      title.toLowerCase().replace(/[^a-z0-9]+/g,"-"),
    specs:{brand,storage,modelNumber:String(index)},
  };
}
const offers=candidates.map(toOffer);

test("precompiled query assessor has byte-for-byte equivalent match semantics across 23 intents and 17 products",()=>{
  for(const query of queries){
    const assess=createOfferMatchAssessor(query);
    const expected=offers.map(offer=>assessOfferMatch(query,offer));
    const actual=offers.map(offer=>assess(offer));
    assert.deepEqual(actual,expected,"query: "+query);
    // A prepared closure must not leak a previous searcher's intent.
    assert.deepEqual(createOfferMatchAssessor(query)(offers[1]),expected[1]);
  }
});

test("prepared matching preserves identity-conflict rejections, unlike fuzzy string matching",()=>{
  const examples=[
    ["iPhone 17 256GB",0,1],
    ["Samsung Galaxy S25",4,5],
    ["PS5",6,8],
    ["bluetooth headphones",12,13],
    ["HP laptop",14,15],
  ];
  for(const [query,valid,wrong] of examples){
    const f=createOfferMatchAssessor(query);
    assert.deepEqual(f(offers[valid]),assessOfferMatch(query,offers[valid]));
    assert.deepEqual(f(offers[wrong]),assessOfferMatch(query,offers[wrong]));
  }
});

test("repeated independent query batches never share mutable variant constraints",()=>{
  const specific=createOfferMatchAssessor("iPhone 17 256GB");
  const broad=createOfferMatchAssessor("iPhone");
  const wrongVariant=offers[2];
  for(let i=0;i<30;i++){
    assert.deepEqual(specific(wrongVariant),assessOfferMatch("iPhone 17 256GB",wrongVariant));
    assert.deepEqual(broad(wrongVariant),assessOfferMatch("iPhone",wrongVariant));
  }
});

test("server uses a per-batch scorer instead of reparsing query intent per returned offer",()=>{
  const s=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  const retain=s.slice(s.indexOf("function retainRelatedOffers("),s.indexOf("function mergeProviderChunks("));
  assert.match(retain,/const assess=createOfferMatchAssessor\(query\)/);
  assert.match(retain,/\.\.\.assess\(offer\)/);
  const search=s.slice(s.indexOf("async function searchAll("),s.indexOf("const cachedSearch =",s.indexOf("async function searchAll(")));
  assert.match(search,/const assessSearchOffer=createOfferMatchAssessor\(query\)/);
  assert.equal((search.match(/assessSearchOffer\(offer\)/g)||[]).length,3);
  assert.equal((search.match(/assessOfferMatch\(query, offer\)/g)||[]).length,0);
});

test("Arabic and English aliases remain canonicalized without changing storage model",()=>{
  assert.equal(normalizeSearchQuery("آيفون 17 256 جيجا"),"iphone 17 256gb");
  assert.equal(normalizeSearchQuery("بلايستيشن 5"),"ps5");
});
