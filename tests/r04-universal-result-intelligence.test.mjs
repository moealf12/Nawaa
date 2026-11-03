import test from "node:test";
import assert from "node:assert/strict";
import {inferSoldSubjectRole,classifyResultGroup,buildIntentAwareResultLanes}
  from "../src/search-result-intelligence.mjs";

const offer=(title,{exactMatch=true,matchConfidence=1,...rest}={})=>({
 title,exactMatch,matchConfidence,productPrice:2500,currency:"SAR",
 condition:"new",merchant:"TEST",sourceUrl:"https://fixture.invalid/p/product",
 ...rest,
});
const group=(key,title,opts={})=>({key,offers:[offer(title,opts)],bestOffer:offer(title,opts),bestValue:2500});
test("R04 universal: false exacts are placed into the sold-subject lane, not erased",()=>{
 const scenarios=[
  ["مكنسة دايسون V15","Dyson V15 Detect Absolute Cordless Vacuum Cleaner","direct"],
  ["مكنسة دايسون V15","Walntec Replacement Filters for Dyson V15 Detect","accessory"],
  ["Dyson V15","LANMU Accessory Holder Compatible with Dyson V15","accessory"],
  ["Canon mirrorless camera","Canon EOS R50 Mirrorless Camera with Lens Kit","direct"],
  ["Canon mirrorless camera","Canon RF50mm f1.8 STM Lens for Canon Mirrorless Camera","accessory"],
  ["Canon mirrorless camera","Canon EOS R50 Mirrorless Camera Guía del Usuario: Mastering Photography","guide"],
  ["ساعة ابل سيريس 11","Apple Watch Series 11 GPS Smartwatch 46mm","direct"],
  ["ساعة ابل سيريس 11","Funda Protectora de Pantalla Completa para Apple Watch Series 11","accessory"],
  ["Apple Watch Series 11","Apple Watch Series 11 Guide for Seniors: A Simple Manual","guide"],
  ["Dyson V15","Build Your Own Vacuum Form Machine","other"],
  ["iPhone 17","Apple iPhone 17 256GB Black","direct"],
  ["iPhone 17","iPhone 17 Protective Case for 6.3 Inch","accessory"],
  ["PS5","Sony PS5 Slim Disc Edition Console 1TB","direct"],
  ["PS5","Sony PlayStation 5 Digital Console White + PS5 PULSE 3D wireless headset + PS5 Dual Sense Wireless Controller","direct"],
  ["iPhone 17","Apple iPhone 17 256GB Black + Protective Case + Screen Protector","direct"],
  ["Apple Watch Series 11","Replacement Strap + Storage Case for Apple Watch Series 11","accessory"],
  ["PS5 console","PS5 Disc Drive Replacement Optical Module","accessory"],
  ["office chair","Ergonomic Office Chair with Lumbar Support","direct"],
  ["office chair","Office Chair Height Lock Bracket Repair Kit","accessory"],
  ["coffee beans","Brazil Arabica Whole Coffee Beans 1kg","direct"],
  ["coffee beans","Barista Coffee Grinder with Burr","accessory"],
  ["JBL headphones","JBL Wireless Bluetooth Headphones 760NC","direct"],
  ["JBL headphones","JBL Headphones Replacement Ear Cushions","accessory"],
  ["HP laptop","HP Pavilion 15 Laptop 16GB RAM 512GB SSD","direct"],
  ["سلسال سواروفسكي","Swarovski Necklace Rhodium Plated Crystal","direct"]
 ];
 for(const [query,title,expected] of scenarios){
  const x=classifyResultGroup(query,group("p",title));
  assert.equal(x.lane,expected,query+": "+title+": "+JSON.stringify(x));
 }
});
test("R04 P3.2 LIVE regression: 25 SAR camera protection must never outrank iPhone 17 handsets",()=>{
 const guard=group("camera-guard","CELLULARLINE CAMERA PROTECTION IPHONE 17");
 assert.equal(inferSoldSubjectRole(guard.bestOffer.title),"accessory");
 const phone=group("phone","Apple iPhone 17 256GB Black");
 const result=buildIntentAwareResultLanes("iPhone 17",[guard,phone]);
 assert.deepEqual(result.primaryGroups.map(x=>x.key),["phone"]);
 assert.equal(result.secondarySections.find(x=>x.key==="accessory")?.groups[0].key,"camera-guard");
 assert.equal(result.partitionedGroups,2);
 // A shopper requesting the protection itself must see it as a direct item.
 assert.equal(classifyResultGroup("iPhone 17 camera protection",guard).lane,"direct");
 // A complete phone with an INCLUDED protector remains a phone.
 for(const title of [
   "Apple iPhone 17 with Camera Protection",
   "Apple iPhone 17 + Camera Protection Kit",
 ]){
   assert.equal(inferSoldSubjectRole(title),"product",title);
 }
 // A protection bundle is not a handset merely because a model leads the SEO title.
 assert.equal(inferSoldSubjectRole("iPhone 17 Camera Protection Bundle"),"accessory");
});

test("R04 P3.2: standalone optical and disc drives are accessories, explicitly requested drives are direct",()=>{
 const standalone=[
   "Sony Disc Drive for PlayStation 5 Digital Edition Slim, White",
   "Disc Drive for PS5 Console",
   "External Optical Drive for Laptop",
 ];
 for(const title of standalone){
   assert.equal(inferSoldSubjectRole(title),"accessory",title);
 }
 const drive=group("disc-drive","Sony Disc Drive for PlayStation 5 Digital Edition Slim");
 assert.equal(classifyResultGroup("PS5 disc drive",drive).lane,"direct");
 assert.equal(classifyResultGroup("PS5",drive).lane,"accessory");
 // Inclusion does not transform the complete console into a separately sold
 // optical drive; with/+ and an explicit complete bundle keep the principal.
 for(const title of [
   "Sony PS5 Console with Disc Drive",
   "Sony PS5 Console + Disc Drive Bundle",
   "Sony PS5 Console Disc Drive Bundle",
 ]){
   assert.equal(inferSoldSubjectRole(title),"product",title);
 }
});

test("R04 universal: explicit accessories and guides are promoted when shopper requests them",()=>{
 for(const [query,title] of [
   ["Dyson V15 filter","Walntec Replacement Filters for Dyson V15 Detect"],
   ["Apple Watch Series 11 strap","Replacement Strap for Apple Watch Series 11"],
   ["Canon RF50mm lens","Canon RF50mm F1.8 STM Lens for Mirrorless Camera"],
   ["Apple Watch Series 11 guide","Apple Watch Series 11 Beginners Guide"],
   ["PS5 controller","Sony DualSense PS5 Controller"]
 ]){
  const x=classifyResultGroup(query,group("k",title));
  assert.notEqual(x.lane,"other",query+" should remain discoverable, got "+JSON.stringify(x));
  assert.notEqual(x.lane,"accessory",query+" should not be relegated solely because accessory was explicitly requested");
 }
});
test("R04 universal: malicious SEO URL/metadata and numeric prices never fabricate primary identity",()=>{
 const poisoned=group("bad","Vacuum Technique",{exactMatch:true,
   sourceUrl:"https://example.org/dyson-v15/vacuum",
   brand:"Dyson",productType:"vacuum",specs:{model:"Dyson V15"},productPrice:0.01});
 const x=classifyResultGroup("Dyson V15",poisoned);
 assert.notEqual(x.lane,"direct");
});
test("R04 universal: partitions are lossless, stable, and never mutate offer evidence",()=>{
 const g=[
  group("principal","Dyson V15 Detect Cordless Vacuum Cleaner"),
  group("part","Replacement Filter for Dyson V15"),
  group("other","Build Your Own Vacuum Form Machine"),
  group("book","Dyson V15 User Guide for Seniors"),
  group("alternative","Dyson V12 Vacuum Cleaner",{exactMatch:false,matchConfidence:.8}),
 ];
 const before=JSON.stringify(g);
 const a=buildIntentAwareResultLanes("Dyson V15",g);
 const b=buildIntentAwareResultLanes("Dyson V15",g);
 const all=[...a.primaryGroups,...a.secondarySections.flatMap(s=>s.groups)];
 assert.equal(a.partitionedGroups,g.length);
 assert.equal(all.length,g.length);
 assert.equal(new Set(all.map(x=>x.key)).size,g.length);
 assert.equal(JSON.stringify(g),before);
 assert.deepEqual(a,b);
 assert.equal(a.secondarySections.find(x=>x.key==="accessory")?.groups.length,1);
 assert.equal(a.secondarySections.find(x=>x.key==="guide")?.groups.length,1);
 assert.equal(a.primaryGroups[0].key,"principal");
});
test("R04 universal: scale 3000 groups with 100% retention and deterministic positions",()=>{
 const groups=Array.from({length:3000},(_,i)=>
  group("g"+i,i%5===0?"Apple Watch Series 11 GPS Smartwatch":
    i%5===1?"Apple Watch Series 11 Replacement Strap":
    i%5===2?"Apple Watch Series 11 User Guide":
    i%5===3?"Apple Watch Series 10 GPS Smartwatch":"Random Unrelated Product",
    {exactMatch:i%5!==3,matchConfidence:i%5!==3?1:.8}));
 const a=buildIntentAwareResultLanes("Apple Watch Series 11",groups);
 assert.equal(a.partitionedGroups,3000);
 assert.equal(a.secondarySections.reduce((n,s)=>n+s.groups.length,0)+a.primaryGroups.length,3000);
 assert.equal(new Set([...a.primaryGroups,...a.secondarySections.flatMap(x=>x.groups)].map(x=>x.key)).size,3000);
});
test("R04 universal: unknown titles and missing offers have their own lower-evidence lane",()=>{
 assert.equal(inferSoldSubjectRole(""),"unknown");
 const rows=buildIntentAwareResultLanes("أي منتج",[group("u",""),{key:"none",offers:[]}]);
 assert.equal(rows.partitionedGroups,2);
 assert.equal(rows.primaryGroups.length,0);
});

test("R04 universal: URL deep-link iPhone 17 original verified cards remain primary",async()=>{
 const {groupComparableOffers,buildDiscoverySections}=await import("../src/search-core.mjs");
 const base={
   merchant:"eXtra",title:"Apple iPhone 17 256GB Black",sourceUrl:"https://example.com/black",
   productPrice:3999,condition:"new",exactMatch:true,matchConfidence:1,dataKind:"live",
   availability:"in_stock",canShipToSaudi:true,shipping:null,importCost:0,tax:null,
   mandatoryFees:0,discount:0,specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256GB",
     color:"Black",modelNumber:"MG674AH/A"}};
 const all=[base,{...base,title:"Apple iPhone 17 256GB White",sourceUrl:"https://example.com/white",
   specs:{...base.specs,color:"White",modelNumber:"MG684AH/A"}}];
 const grouped=groupComparableOffers(all,"lowest");
 const classified=buildIntentAwareResultLanes("ايفون 17",grouped);
 assert.equal(classified.primaryGroups.length,2,
   "iPhone direct lanes "+JSON.stringify(classified.secondarySections.map(x=>({key:x.key,titles:x.groups.map(g=>g.bestOffer.title)}))));
 const cats=buildDiscoverySections("ايفون 17",classified.primaryGroups);
 assert.equal(cats.reduce((n,x)=>n+x.groups.length,0),2);
});
