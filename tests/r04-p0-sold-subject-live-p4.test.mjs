import test from "node:test";
import assert from "node:assert/strict";
import {assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

// Exact public post-272 merchant titles sampled in immutable GitHub Actions
// run 41542664011, artifact 13187805070. All other offer attributes are
// adversarial synthetic fixtures, not actual merchant price/stock claims.
const wrong=[
 ["Dyson V15","Fullclean Accessories Mount Holder for Dyson V15 V8 V7 V10 V11 Absolute Animal Trigger Motorhead Attachments With Expansion"],
 ["Dyson V15","LANMU Accessory Holder Compatible with Dyson V15 V12 V11 V10 V8 V7 Outsize Gen5 G5 Cordless Stick Vacuum Cleaner, Docking Stand"],
 ["Dyson V15","Walntec Blue Replacement Filters for Dyson V15 Detect, V15 Detect+, V11 Torque Drive, V11 Animal, and SV14 Cordless Stick"],
 ["Dyson V15","Unikstone Mattress Tool for Dyson v15 V11 V10 V8 V7 Absolute Cyclone Torque Drive Outsize Animal Trigger Motorhead"],
 ["Dyson V15","Replacement Wand Compatible with Dyson V15 V11 V10 V8 V7 Cordless Stick Vacuum Cleaner,Quick Release Vacuum Accessories (Blue)"],
 ["مكنسة دايسون V15","NEW Genuine Dyson V15 SV22 Detect Vacuum Cyclone Assembly Runner Spare 965478-15"],
 ["Dyson V15 vacuum cleaner","Aieve Trigger Lock for Dyson Vacuum Cleaner,Trigger Lock Power Button Off/On Switch Accessory Holder for Dyson V15"],
 ["Dyson V15 vacuum cleaner","DrRobor Electric Mop Head Attachment for Dyson V15 V11 V10 V8 V7 Vacuum Cleaner with Detachable Water Tank"],
 ["Dyson V15 vacuum cleaner","Updated Dust Detect Vacuum Attachments for Dyson V15 V11 V10 V8 V7 Cleaner, Hardwood Floor Head Soft Roller Brush Replacement"],
 ["كاميرا كانون بدون مرآة","Canon EOS R50 Mirrorless Camera Guía del Usuario 2026-2027: Domina la fotografía y el vídeo paso a paso"],
 ["كاميرا كانون بدون مرآة","Canon RF50mm F1.8 STM for Canon Full Frame Mirrorless RF Mount Cameras [EOS R, EOS RP, EOS R5, EOS R6](4515C002)"],
 ["كاميرا كانون بدون مرآة","DJI RS 4 Combo, 3-Axis Gimbal Stabilizer for DSLR and Mirrorless Cameras Canon/Sony/Panasonic/Nikon"],
 ["ساعة ابل سيريس 11","Funda Protectora de Pantalla Completa para Apple Watch Series 11 10 9 8 7 6 SE 42/46mm"],
 ["ساعة ابل سيريس 11","OXWALLEN Stretch Solo Loop Band Compatible with Apple Watch Series 11/10/9/8/7/6/5/4 SE 3/2/1"],
 ["ساعة ابل سيريس 11","Apple Watch Series 10 VS Series 11 Comparison Guide: Everything You Need to Know Before You Upgrade"],
 ["ساعة ابل سيريس 11","Apple Watch Series 11 Guide for Seniors: A Simple Step-by-Step Manual to Set Up Your Device"],
 ["ساعة ابل سيريس 11","Apple Watch Series 11 Mastering Guide: Unlock Hidden Features, Health Tools & Smart Tips"]
];
const valid=[
 ["Dyson V15","Dyson V15 Detect Submarine, Vacuum Cleaner"],
 ["Dyson V15 vacuum cleaner","Dyson V15 Detect Absolute Cordless Vacuum Cleaner, Silver – Middle East Version"],
 ["مكنسة دايسون V15","Dyson V15 Detect Absolute Cordless Vacuum, 0.77L, 240AW, Yellow/Iron/Nickle"],
 ["كاميرا كانون بدون مرآة","Canon EOS R100 Mirrorless Camera, 24.1 Mega Pixel, WiFi, Black"],
 ["كاميرا كانون بدون مرآة","Canon EOS R50 Mirrorless Camera with RF-S 18-45mm Lens Kit"],
 ["ساعة ابل سيريس 11","Apple Watch Series 11 GPS Smartwatch 46mm"],
 ["ساعة ابل سيريس 11","Apple Watch Series 11 GPS 42mm with Sport Band"],
 ["Canon RF50mm lens","Canon RF50mm F1.8 STM for Canon Full Frame Mirrorless RF Mount Cameras"],
 ["Dyson V15 replacement wand","Replacement Wand Compatible with Dyson V15 Cordless Stick Vacuum Cleaner"],
 ["Dyson V15 filter","Walntec Blue Replacement Filters for Dyson V15 Detect"],
 ["Apple Watch Series 11 screen protector","Funda Protectora de Pantalla Completa para Apple Watch Series 11"],
 ["Apple Watch Series 11 guide","Apple Watch Series 11 Guide for Seniors: A Simple Step-by-Step Manual"]
];
const fixture=(title)=>({
 title,brand:"Dyson Canon Apple",productType:"",
 sourceUrl:"https://synthetic.invalid/search/retail-model",
 specs:{brand:"Dyson Canon Apple"},provider:"TEST",merchant:"TEST",
 condition:"new",availability:"in_stock",productPrice:999,currency:"SAR"
});
test("R04 P4 RED: actual separately SOLD peripherals/books can never exact-match their principal",()=>{
 for(const [query,title] of wrong){
  const o=fixture(title),m=assessOfferMatch(query,o);
  assert.equal(m.exactMatch,false,"WRONG_SOLD_SUBJECT "+query+" :: "+title+" :: "+JSON.stringify(m));
  assert.equal(filterQueryOffers(query,[o]).offers.length,0,"LEAKED "+query+" :: "+title);
 }
});
test("R04 P4: preserve complete devices, physical camera kits, and explicit accessory shoppers",()=>{
 for(const [query,title] of valid){
  const m=assessOfferMatch(query,fixture(title));
  const accessoryIntent=/\b(?:lens|filter|wand|screen protector|guide)\b/.test(query);
  assert.ok(m.matchConfidence>=(accessoryIntent?.01:.65),"OVERBLOCKED "+query+" :: "+title+" :: "+JSON.stringify(m));
 }
});
