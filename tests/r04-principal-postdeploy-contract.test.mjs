import test from "node:test";
import assert from "node:assert/strict";
import {CASE_IDS,knownWrongRetailSubject,evaluateObservedRow} from "../scripts/r04-principal-postdeploy-live.mjs";
const wrong=[
 ["Q19","Canon EF 50MM f/1.8 STM Prime Lens, for Canon DSLR Camera"],
 ["Q19","Camera Hand Strap Wrist Strap for Canon EOS DSLR Mirrorless Camera"],
 ["Q21","My Happy Childhood Home - Vacuum Cleaner Kid's Pretend Play, 5 Years and Above"],
 ["Q29","Model Miniature Furnitures, Office Set: Desk;Cabinet;Chair, 1:100, 3 Pieces"],
 ["Q30","YelaJoy Office Chair Sagging Fix Clamp Height-Lock Bracket"],
 ["Q31","MIBRU A small spray to moisturize the coffee beans before grinding 30ml Empty Makeup Sprayer"],
 ["Q32","3D Stickers, Coffee: Cup Brown, 1 Piece"],
 ["Q33","Compatible with Apple Watch Strap Braided Sport Loop Band for Series 11"],
 ["Q07","PlayStation 5 Disc Drive Empty Shell Optical Drive Housing Replacement Part"]
];
const valid=[
 ["Q19","Canon EOS R50 Mirrorless Camera Lens Kit"],
 ["Q21","Dyson V15 Cordless Vacuum Cleaner"],
 ["Q29","Ergonomic Office Chair Full Size"],
 ["Q30","كرسي مكتب مريح"],
 ["Q31","Premium Arabica Coffee Beans 1kg"],
 ["Q32","بن قهوة محمصة 250 جرام"],
 ["Q33","Apple Watch Series 11 GPS Smartwatch 42mm with Sport Band"],
 ["Q07","Sony PS5 Disc Drive CFI-ZDD1 External Blu-ray Drive"]
];
const card=title=>({bestOffer:{title,merchant:"Test",sourceUrl:"https://shop.example/p/sku?token=SECRET"}});
test("known independently observed wrong retail titles receive grade 0",()=>{
 for(const [id,title]of wrong)assert.equal(knownWrongRetailSubject(id,title),true,id+": "+title);
});
test("known complete products and included bundles are not wrong subjects",()=>{
 for(const [id,title]of valid)assert.equal(knownWrongRetailSubject(id,title),false,id+": "+title);
});
test("unknown titles are NULL and no qualifying offers means no certification",()=>{
 assert.deepEqual(evaluateObservedRow("Q19",[card("Unknown Canon device")]).firstTen.map(x=>x.grade),[null]);
 assert.equal(evaluateObservedRow("Q19",[]).state,"NO_STRICT_GROUPS");
 assert.equal(evaluateObservedRow("Q19",[card(wrong[0][1])]).state,"KNOWN_WRONG_VISIBLE");
 assert.equal(evaluateObservedRow("Q19",[card(valid[0][1])]).state,"OBSERVED_UNCERTIFIED");
});
test("evidence truncates source URL to host and nonreversible path digest",()=>{
 const row=evaluateObservedRow("Q19",[card("Unknown Canon device")]);
 const serialized=JSON.stringify(row);
 assert.ok(!serialized.includes("SECRET"));
 assert.ok(!serialized.includes("/p/sku"));
 assert.equal(row.firstTen[0].sourceHost,"shop.example");
 assert.equal(row.firstTen[0].sourcePathDigest.length,16);
});
test("R04 case IDs are unique and include each proven P1 issue type",()=>{
 assert.equal(new Set(CASE_IDS).size,CASE_IDS.length);
 for(const id of ["Q07","Q19","Q21","Q29","Q30","Q31","Q32","Q33"])
   assert.ok(CASE_IDS.includes(id));
});

test("R04 independent RED: newly observed LIVE wrong subjects must be detected",()=>{
 const newFailures=[
  ["Q07","Blu-ray DVD Disc Drive Module for PS5 CFI-1200 CFI-1215A Replacement KEM-497AAA Optical Disc Drive Connector"],
  ["Q19","Canon EOS R100 Quick Setup Pocket Guide: Master Your Camera Settings"],
  ["Q19","Canon EOS R8: Master Your Mirrorless Camera: Buttons Modes Settings"],
  ["Q21","Dryer Vent Cleaner Kit for Dyson V15 V12 Vacuum Cleaner Vacuum Attachment Vent Lint Remover"],
  ["Q21","Quick Release Extension Wand Compatible for Dyson V15 V11 V10 Stick Vacuum Cleaners"],
  ["Q29","Folding Chair, PP Molded Seat and Backrest/Powder Coated Steel Leg and Frame, Black"],
  ["Q30","Carnation Student Chair, with Wheels, Light Blue"],
  ["Q32","Mustard Coffee Crew Mug, Dog Reusable Coffee Mug, Cold, Red"],
  ["Q32","The Little Book of Coffee - A Collection of Quotes"],
  ["Q33","1 Pack Silver Rhinestone Band for Apple Watch 42 44 45 49mm Series 10 11"],
  ["Q33","ERYNK Display Glass Front Glass Replacement for Apple Watch Series 11 46 mm"],
  ["Q33","WSKEN Pack of 4 for Apple Watch Series 11 Tempered Glass TPU Film"]
 ];
 for(const [id,title]of newFailures)
   assert.equal(knownWrongRetailSubject(id,title),true,"FALSE_NEGATIVE "+id+": "+title);
});
