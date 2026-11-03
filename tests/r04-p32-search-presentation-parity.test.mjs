import test from "node:test";
import assert from "node:assert/strict";
import {buildSearchPresentationSections} from "../src/search-result-presentation.mjs";

const offer=(title,overrides={})=>({
  title,sourceUrl:"https://fixture.invalid/p/"+encodeURIComponent(title),
  merchant:"Fixture",provider:"fixture",productPrice:2000,currency:"SAR",
  condition:"new",exactMatch:true,matchConfidence:1,
  availability:"in_stock",canShipToSaudi:true, ...overrides,
});
const group=(key,title,overrides={})=>{
  const bestOffer=offer(title,overrides);
  return {key,offers:[bestOffer],bestOffer,bestPriceOffer:bestOffer};
};
const keys=sections=>sections.flatMap(section=>section.groups.map(g=>g.key));
const assertLossless=(input,result)=>{
  assert.equal(result.inputGroups,input.length);
  assert.equal(result.partitionedGroups,input.length);
  const actual=[...result.exactGroups,...result.relatedGroups].map(x=>x.key);
  assert.equal(new Set(actual).size,input.length);
  assert.deepEqual([...actual].sort(),input.map(x=>x.key).sort());
};

test("R04 P3.2: primary console, accessory and guide share one lossless UI/audit partition",()=>{
  const groups=[
    group("console","Sony PS5 Slim Disc Edition Console 1TB"),
    group("drive","PS5 Disc Drive Replacement Optical Module"),
    group("guide","PS5 Console User Guide for Beginners"),
    group("near","Sony PlayStation 4 Console",{exactMatch:false,matchConfidence:.7}),
  ];
  const before=JSON.stringify(groups);
  const result=buildSearchPresentationSections("PS5",groups);
  assertLossless(groups,result);
  assert.equal(JSON.stringify(groups),before);
  assert.deepEqual(result.exactGroups.map(x=>x.key),["console"]);
  assert.ok(result.secondarySections.find(x=>x.key==="accessory")?.groups.some(x=>x.key==="drive"));
  assert.ok(result.secondarySections.find(x=>x.key==="guide")?.groups.some(x=>x.key==="guide"));
});

test("R04 P3.2: no strict matches does NOT mean zero shopper results",()=>{
  const groups=[group("strap","Apple Watch Series 11 Replacement Strap",
    {matchConfidence:1,exactMatch:true})];
  const result=buildSearchPresentationSections("Apple Watch Series 11",groups);
  assertLossless(groups,result);
  assert.equal(result.exactGroups.length,0);
  assert.equal(result.relatedGroups.length,1);
  assert.equal(result.secondarySections[0].key,"accessory");
});

test("R04 P3.2: requested condition mismatch remains discoverable but not certified as direct",()=>{
  const groups=[group("new","Apple iPhone 17 256GB Black")];
  const result=buildSearchPresentationSections("iPhone 17 used",groups);
  assertLossless(groups,result);
  assert.equal(result.exactGroups.length,0);
  assert.equal(result.relatedGroups.length,1);
  assert.equal(result.secondarySections[0].key,"alternative");
});

test("R04 P3.2: unrelated query and negative controls never gain false principal badges",()=>{
  const groups=[
    group("phone-case","iPhone 17 Protective Case 256GB"),
    group("unrelated","Nespresso Coffee Beans",{exactMatch:false,matchConfidence:.1}),
  ];
  const result=buildSearchPresentationSections("iPhone 17",groups);
  assertLossless(groups,result);
  assert.equal(result.exactGroups.length,0);
  assert.equal(result.relatedGroups.length,2);
});

test("R04 P3.2: 1000 identity groups partition deterministically, no omissions",()=>{
  const groups=Array.from({length:1000},(_,i)=>
    group("k"+i,i%2?"Apple Watch Series 11 GPS Smartwatch":
      "Apple Watch Series 11 Replacement Strap",
      {exactMatch:i%4!==0,matchConfidence:i%4!==0?1:.6}));
  const first=buildSearchPresentationSections("Apple Watch Series 11",groups);
  const again=buildSearchPresentationSections("Apple Watch Series 11",groups);
  assertLossless(groups,first);
  assert.deepEqual(keys(first.discoverySections),keys(again.discoverySections));
  assert.deepEqual(keys(first.secondarySections),keys(again.secondarySections));
});
