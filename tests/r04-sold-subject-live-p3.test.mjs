import test from "node:test";
import assert from "node:assert/strict";
import {assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

// Real observed titles from exact-P2 LIVE artifact 13182424251.
// URL, productType and price are adversarial synthetic test fixtures,
// NOT merchant offer measurements.
const wrong = [
 ["Q21","Dyson V15 vacuum cleaner","Replacement Vacuum Cleaner Hose for Dyson V6 V7 V8 V10 V11 V15 - Perfect Fit"],
 ["Q21","Dyson V15 vacuum cleaner","for Dyson V7 V10 V11 V15 Vacuum Cleaner Attachment Accessories Kit Replacement"],
 ["Q21","Dyson V15 vacuum cleaner","Upgraded Dust Bin Replacement for Dyson V11 V15 SV14 SV15 SV22 Vacuum Cleaner"],
 ["Q21","Dyson V15 vacuum cleaner","DYSON ANTI TANGLE VACUUM CLEANER FLOOR BRUSH HEAD V15 971358-02 Genuine"],
 ["Q21","Dyson V15 vacuum cleaner","Dyson V15 Vacuum Cleaner Main Body & Cyclone - Yellow 965478-11"],
 ["Q30","كرسي مكتب","YelaJoy 2PCS Fix Sinking Chair Kit, Stainless Steel Office Chair Saver Height Adjustable Repair Kit, No Cylinder Replacement"],
 ["Q30","كرسي مكتب","FOH Replace Swivel Caster Wheels to Fixed Stationary Foot, Dia 7/16 stem fit Most Office Chair"],
 ["Q30","كرسي مكتب","Adjustable Ergonomic Office Chair Headrest Attachment, Universal Height and Angle Adjustable Memory Foam Headrest"],
 ["Q30","كرسي مكتب","LargeLeaf Chair Ergonomic armrest Cushions Elbow Pillow Pressure Relief Office Chair Gaming Chair armrest with Memory Foam"],
 ["Q32","بن قهوة","Mibru v60 pour over premium coffee set of 2 includes coffee server 02 coffee dripper 02, barista tools"],
 ["Q32","بن قهوة","The Little Book for Coffee Lovers - All About Coffee"],
 ["Q32","بن قهوة","Coffee, climate change and adaption strategies for German coffee producers"],
 ["Q32","بن قهوة","Green Coffee - A weight loss guarantee?: How you can lose weight quickly and easily with green coffee"],
 ["Q32","بن قهوة","Coffee. Dedication. Dr. Mia Miau.: From the first dream to the white coat"]
];
const valid=[
 ["Dyson V15 vacuum cleaner","Dyson V15 Detect Absolute Cordless Vacuum Cleaner"],
 ["Dyson V15 vacuum cleaner","Dyson V15 Cordless Vacuum Cleaner with Advanced HEPA Filter"],
 ["Dyson V15 vacuum hose","Replacement Vacuum Cleaner Hose for Dyson V15"],
 ["Dyson V15 dust bin","Upgraded Dust Bin Replacement for Dyson V15 Vacuum Cleaner"],
 ["office chair","Ergonomic Office Chair High Back Adjustable"],
 ["كرسي مكتب","كرسي مكتب مريح قابل للتعديل"],
 ["office chair headrest attachment","Ergonomic Office Chair Headrest Attachment Universal"],
 ["كرسي مكتب عجلات","عجلات كرسي مكتب بديلة"],
 ["coffee beans","Premium Arabica Coffee Beans 1kg"],
 ["coffee beans","Illy Classico Whole Roasted Coffee Beans 250g"],
 ["بن قهوة","بن قهوة عربية محمصة 250 جرام"],
 ["بن قهوة","حبوب قهوة مختصة محمصة 250 جرام"],
 ["coffee dripper","Mibru V60 Coffee Dripper 02"],
 ["coffee mug","Mustard Coffee Crew Mug Reusable Coffee Mug"]
];
const fixture=(query,title,id)=>({
 title,brand:query,productType:query,
 sourceUrl:"https://fixture.example/valid/"+encodeURIComponent(query)+"/"+encodeURIComponent(id),
 provider:"fixture",merchant:"not-a-live-merchant",condition:"new",availability:"in_stock",
 productPrice:999,currency:"SAR",specs:{}
});
test("R04 P3 RED: independently observed spare parts/books/tools never exact-match principal goods",()=>{
 for(const [id,query,title]of wrong){
   const o=fixture(query,title,id),m=assessOfferMatch(query,o);
   assert.equal(m.exactMatch,false,id+" wrongly exact: "+title);
   assert.equal(filterQueryOffers(query,[o]).offers.length,0,id+" leaked: "+title);
 }
});
test("R04 P3: genuine principal products and explicitly sought accessories remain available",()=>{
 for(const [query,title]of valid){
   const o=fixture(query,title,title.slice(0,12)),m=assessOfferMatch(query,o);
   assert.ok(m.matchConfidence>=.65,"wrongly demoted "+query+" / "+title+": "+JSON.stringify(m));
 }
});
