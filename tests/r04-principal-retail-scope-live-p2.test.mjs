import test from "node:test";
import assert from "node:assert/strict";
import {assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

// Titles below are from GitHub Action 41529317290 / artifact 13181286773.
// ProductType metadata and URLs are intentionally adversarial TEST FIXTURES,
// not assertions about the actual merchant fields or live inventory.
const wrong=[
 ["Q07","PS5 Disc Drive","Blu-ray DVD Disc Drive Module for PS5 CFI-1200 CFI-1215A Replacement KEM-497AAA Optical Disc Drive Connector"],
 ["Q19","Canon mirrorless camera","Canon EOS R100 Quick Setup Pocket Guide: Master Your Camera Settings"],
 ["Q19b","Canon mirrorless camera","Canon EOS R8: Master Your Mirrorless Camera: Buttons, Modes, Settings, and Shooting Tips"],
 ["Q19c","Canon mirrorless camera","Cwatcun Camera Sling Bag for Women Small Crossbody Bag Compatible for Canon Mirrorless Cameras"],
 ["Q21","Dyson V15 vacuum cleaner","Dryer Vent Cleaner Kit for Dyson V15 V12 V11 Vacuum Cleaner Vacuum Attachment Vent Lint Remover"],
 ["Q21b","Dyson V15 vacuum cleaner","Quick Release Extension Wand Compatible for Dyson V15 V11 V10 Vacuum Cleaners"],
 ["Q21c","Dyson V15 vacuum cleaner","Ninthseason Quick-Release Direct Drive Cleaner Head Turbine Floor Tool for Dyson V15 Vacuum"],
 ["Q29","office chair","Folding Chair, PP Molded Seat and Backrest/Powder Coated Steel Leg and Frame, Black"],
 ["Q30","كرسي مكتب","Carnation Student Chair, with Wheels, Light Blue"],
 ["Q32","بن قهوة","Mustard Coffee Crew Mug, Dog Reusable Coffee Mug, Cold, Red"],
 ["Q32b","بن قهوة","The Little Book of Coffee - A Collection of Quotes"],
 ["Q32c","بن قهوة","MIBRU Coffee filter for american coffee 200mm B03"],
 ["Q33","Apple Watch Series 11","1 Pack Silver Rhinestone Band for Apple Watch 42 44 45 49mm Series 10 11"],
 ["Q33b","Apple Watch Series 11","ERYNK Display Glass Front Glass Replacement for Apple Watch Series 11 46 mm"],
 ["Q33c","Apple Watch Series 11","WSKEN Pack of 4 for Apple Watch Series 11 Tempered Glass TPU Film"]
];
const positives=[
 ["Canon mirrorless camera","Canon EOS R50 Mirrorless Camera Lens Kit"],
 ["Canon mirrorless camera","Canon EOS R50 Mirrorless Camera Body"],
 ["Canon 50mm lens","Canon EF 50MM f/1.8 STM Prime Lens for Canon DSLR Camera"],
 ["Dyson V15 vacuum cleaner","Dyson V15 Detect Absolute Cordless Vacuum Cleaner Silver"],
 ["Dyson V15 vacuum filter","Suitable for Dyson V15 Vacuum Cleaner Replacement Filter"],
 ["office chair","Brim,Office chair"],
 ["office chair clamp","YelaJoy Office Chair Sagging Fix Clamp Height Lock Bracket"],
 ["coffee beans","Premium Arabica Coffee Beans 1kg"],
 ["بن قهوة","بن قهوة مختصة محمصة 250 جرام"],
 ["coffee mug","Mustard Coffee Crew Mug Reusable Coffee Mug"],
 ["Apple Watch Series 11","Apple Watch Series 11 GPS Smartwatch 42mm with Sport Band"],
 ["Apple Watch strap","Compatible with Apple Watch Strap Braided Sport Loop Band for Series 11"],
 ["PS5 Disc Drive","Sony Disc Drive for PlayStation 5 Digital Edition Slim, White"]
];
const fixture=(query,title,id)=>({
 title,brand:query,productType:query,
 sourceUrl:"https://test-only.example/"+encodeURIComponent(query)+"/"+encodeURIComponent(id),
 provider:"test_fixture",merchant:"TEST NOT LIVE",condition:"new",availability:"in_stock",
 productPrice:999,currency:"SAR",specs:{},observedAt:"2026-11-02T00:00:00Z"
});
test("R04 P2 RED: fifteen observed standalone retail subjects cannot exact-match the complete item",()=>{
 for(const [id,query,title] of wrong){
   const x=fixture(query,title,id),m=assessOfferMatch(query,x);
   assert.equal(m.exactMatch,false,id+" falsely exact-matched "+title);
   assert.equal(filterQueryOffers(query,[x]).offers.length,0,id+" leaked into strict discovery");
 }
});
test("R04 P2: preserve actual principals, included kit and explicitly requested accessory intents",()=>{
 for(const [query,title]of positives){
  const x=fixture(query,title,title.slice(0,12));
  const m=assessOfferMatch(query,x);
  assert.ok(m.matchConfidence>=.65,query+" wrongly excluded "+title+" "+JSON.stringify(m));
 }
});
