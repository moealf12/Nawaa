import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSearchQuery,parseSearchIntent,assessOfferMatch,filterQueryOffers,
} from "../src/search-query.mjs";
import {classifyResultGroup} from "../src/search-result-intelligence.mjs";

const offer=(title,overrides={})=>({
  title,merchant:"Observed Merchant",provider:"free-storefronts",
  providerMarket:"test-independent-merchant",
  productPrice:100,currency:"SAR",condition:"new",
  sourceUrl:"https://merchant.example/p/evidence",availability:"in_stock",
  specs:{},...overrides,
});

function presentable(query,product){
  const evidence={...product,...assessOfferMatch(query,product)};
  return {evidence,decision:classifyResultGroup(query,{key:"one",bestOffer:evidence})};
}

test("R04 root: Spanish protective tablet cases normalize at discovery, filter and sold-title classification",()=>{
  const q="funda para tablet samsung";
  assert.equal(normalizeSearchQuery(q),"case tablet samsung");
  const retail=offer("Samsung Tablet Protective Case");
  const match=presentable(q,retail);
  assert.equal(parseSearchIntent(q).category,"accessory");
  assert.equal(match.evidence.exactMatch,true,JSON.stringify(match));
  assert.equal(match.decision.lane,"direct");
  assert.equal(filterQueryOffers(q,[retail]).offers.length,1);
  // Neither a device sold separately nor a different device variant can
  // become the requested accessory merely because model words overlap.
  assert.notEqual(presentable(q,offer("Samsung Tablet S9 Device 128GB")).decision.lane,"direct");
});

test("R04 root: French sulfate-free shampoo retains its exclusionary ingredient claim",()=>{
  const q="shampoing sans sulfate";
  assert.equal(normalizeSearchQuery(q),"sulfate free shampoo");
  const retail=offer("Sulfate Free Shampoo 300ml");
  assert.equal(parseSearchIntent(q).providerQuery,"sulfate free shampoo");
  assert.equal(presentable(q,retail).decision.lane,"direct");
  assert.notEqual(presentable(q,offer("Regular Shampoo With Sulfates 300ml")).decision.lane,"direct");
});

test("R04 root: unrelated French, Spanish and German structural terms share one normalization path",()=>{
  const cases=[
    ["chaussures randonnée imperméables","waterproof hiking shoes"],
    ["schutzhülle galaxy s25","Samsung Galaxy S25 Case"],
    ["auriculares inalámbricos","Wireless Headphones"],
    ["écouteurs sans fil","Wireless Earbuds"],
    ["protector de pantalla samsung","Samsung Screen Protector"],
    ["ordenador portátil","Laptop"],
  ];
  for(const [query,title] of cases){
    const product=offer(title);
    const canonical=normalizeSearchQuery(query);
    assert.equal(normalizeSearchQuery(canonical),canonical,query);
    assert.equal(presentable(query,product).evidence.exactMatch,true,
      query+" -> "+canonical+" -> "+title);
  }
});

test("R04 root: certified Galaxy variant remains hard boundary after German accessory translation",()=>{
  const query="schutzhülle galaxy s25";
  assert.equal(presentable(query,offer("Samsung Galaxy S25 Case")).decision.lane,"direct");
  for(const title of ["Samsung Galaxy S24 Case","Samsung Galaxy S25 Ultra Case"]){
    const matched=presentable(query,offer(title));
    assert.notEqual(matched.decision.lane,"direct",title);
  }
});

test("R04 root: language normalization cannot weaken buyer condition or fabricate title identity",()=>{
  for(const [query,title,condition] of [
    ["funda para tablet samsung","Samsung Tablet Protective Case","used"],
    ["shampoing sans sulfate","Sulfate Free Shampoo","refurbished"],
  ]){
    assert.notEqual(presentable(query,offer(title,{condition})).decision.lane,"direct");
  }
  const q="funda para tablet samsung";
  const wrong=offer("Samsung Laptop Charger");
  assert.notEqual(presentable(q,wrong).decision.lane,"direct");
});

test("R04 root: untouched English, Arabic, exact model IDs and numeric buyer constraints",()=>{
  const original=[
    "iPhone 17 256GB","PS5 Digital Edition",
    "Samsung Galaxy S25 Ultra","حافظة ايفون 17","قارئ اقراص بلايستيشن 5",
    "RF111","MXL-42","100W","16GB RAM","HD-662F",
  ];
  for(const query of original){
    const canonical=normalizeSearchQuery(query);
    assert.equal(normalizeSearchQuery(canonical),canonical,query);
    assert.ok(!/(?:undefined|null)/.test(canonical),query);
  }
  assert.equal(normalizeSearchQuery("iPhone 17 256GB"),"iphone 17 256gb");
  assert.equal(normalizeSearchQuery("RF111"),"rf111");
  assert.equal(normalizeSearchQuery("HD-662F"),"hd 662f");
});

test("R04 root: bounded scalar normalization remains stable across 2000 merchant titles",()=>{
  const source=Array.from({length:2000},(_,i)=>i%4===0
    ? "Samsung Tablet Case "+i
    : i%4===1?"Waterproof Hiking Shoes "+i
    : i%4===2?"Sulfate Free Shampoo "+i
    :"iPhone 17 256GB "+i);
  const result=source.map(normalizeSearchQuery);
  assert.equal(result.length,2000);
  assert.ok(result.every((x,i)=>x===normalizeSearchQuery(source[i])));
});
