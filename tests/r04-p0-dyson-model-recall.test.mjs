import test from "node:test";
import assert from "node:assert/strict";
import {parseSearchIntent,buildProviderFallbackQueries,assessOfferMatch,filterQueryOffers}
 from "../src/search-query.mjs";

// Titles listed here were observed on exact-LIVE post-270 production:
// GitHub Actions run 41539844876 / artifact 13185507106.
// All other fields below are deliberately synthetic adversarial metadata.
const item=(title,{productType="vacuum",brand="Dyson",sourceUrl="https://fixture.invalid/search/dyson-v15"}={})=>({
 title,productType,brand,sourceUrl,condition:"new",availability:"in_stock",
 merchant:"TEST_ONLY",provider:"TEST",productPrice:999,currency:"SAR",specs:{brand:"Dyson"}
});
const wrong=[
 "Build Your Own Vacuum Form Machine",
 "Vacuum Technique",
 "Vacuum Microbalance Techniques: Volume 5",
 "The Physical Basis of Ultrahigh Vacuum",
 "Vacuum Technology : Practice for Scientific Instruments",
 "TP-Link Tapo RV10 Robot Vacuum & Mop, Bluetooth, Works with Amazon Alexa",
 "Xiaomi Robot Vacuum S10+ Bluetooth, Black",
 "TP-Link Tapo RV20 Max Robot Vacuum & Mop",
 "Xiaomi ROBOVAC S40 Robot Vacuum Bluetooth, White",
 "Dyson V11 Cordless Vacuum Cleaner",
 "Dyson V15s Detect Submarine Wet and Dry Vacuum Cleaner"
];
const valid=[
 "Dyson V15 Detect Submarine, Vacuum Cleaner",
 "Dyson V15 Detect Total Clean Cordless Vaccum Cleaner - Middle East Version",
 "Dyson V15 Detect Absolute Cordless Vacuum Cleaner, Silver",
 "Dyson V15 Detect Absolute Cordless Vacuum, 0.77L, Yellow",
];
test("R04 P0 RED: named Dyson V15 cannot be reduced to broad brand discovery",()=>{
 const intent=parseSearchIntent("Dyson V15");
 assert.equal(intent.model,"dyson v15");
 assert.equal(intent.discoveryMode,"specific");
});
test("R04 P0 RED: preserve exact physical model despite adversarial metadata and search URL",()=>{
 for(const title of wrong){
   const offer=item(title);
   const score=assessOfferMatch("Dyson V15",offer);
   assert.equal(score.exactMatch,false,"MODEL_FALSE_POSITIVE "+title+" "+JSON.stringify(score));
   assert.equal(filterQueryOffers("Dyson V15",[offer]).offers.length,0,title);
 }
});
test("R04 P0: retain verified whole Dyson V15 retail titles without metadata or SEO paths",()=>{
 for(const title of valid){
   const offer=item(title,{brand:"",productType:"",sourceUrl:"https://fixture.invalid/p/sku"});
   const score=assessOfferMatch("Dyson V15",offer);
   assert.equal(score.exactMatch,true,"VALID_DYSON_REJECTED "+title+" "+JSON.stringify(score));
 }
});
test("R04 P0 RED: Arabic Dyson V15 query has model-preserving bounded source fallback",()=>{
 const fallbacks=buildProviderFallbackQueries("مكنسة دايسون V15");
 assert.equal(fallbacks[0],"dyson v15",
   "Do not make category-only dyson vacuum outrank a precise modeled source search");
});
test("R04 P0: exact accessory searches stay eligible and are not classified as whole vacuums",()=>{
 for(const [query,title] of [
  ["Dyson V15 replacement hose","Replacement Vacuum Cleaner Hose for Dyson V15"],
  ["Dyson V15 filter","Dyson V15 Replacement Filter Pack"],
  ["Dyson V15 dust bin","Dyson V15 Replacement Dust Bin"],
 ]){
  const s=assessOfferMatch(query,item(title,{productType:"accessory"}));
  assert.ok(s.matchConfidence>0,query+" "+JSON.stringify(s));
 }
});
