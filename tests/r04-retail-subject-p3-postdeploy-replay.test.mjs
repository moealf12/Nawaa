import test from "node:test";
import assert from "node:assert/strict";
import {assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";
// Exact retail-title observations: post-P2 LIVE GitHub Actions run 41533253588,
// immutable artifact 13182424251 (2026-11-02 UTC). All offer fields below except
// query and source title are deliberately synthetic adversarial test fixtures.
const negative=[
 ["Q21-a","Dyson V15 vacuum cleaner","Replacement Vacuum Cleaner Hose for Dyson V6 V7 V8 V10 V11 V15 - Perfect Fit"],
 ["Q21-b","Dyson V15 vacuum cleaner","for Dyson V7 V10 V11 V15 Vacuum Cleaner Attachment Accessories Kit Replacement"],
 ["Q21-c","Dyson V15 vacuum cleaner","Upgraded Dust Bin Replacement for Dyson V11 V15 SV14 SV15 SV22 Vacuum Cleaner"],
 ["Q21-d","Dyson V15 vacuum cleaner","DYSON ANTI TANGLE VACUUM CLEANER FLOOR BRUSH HEAD V15 971358-02 Genuine"],
 ["Q21-e","Dyson V15 vacuum cleaner","Dyson V15 Vacuum Cleaner Main Body & Cyclone - Yellow 965478-11"],
 ["Q30-a","كرسي مكتب","YelaJoy 2PCS Fix Sinking Chair Kit, Stainless Steel Office Chair Saver Height Adjustable Repair Kit, No Cylinder Replacement"],
 ["Q30-b","كرسي مكتب","FOH Replace Swivel Caster Wheels to Fixed Stationary Foot, Dia 7/16 inch stem fit Most Office Chair"],
 ["Q30-c","كرسي مكتب","Adjustable Ergonomic Office Chair Headrest Attachment, Universal Height and Angle Adjustable Memory Foam Headrest"],
 ["Q30-d","كرسي مكتب","LargeLeaf Chair Ergonomic armrest Cushions Elbow Pillow Office Chair Gaming Chair armrest"],
 ["Q30-e","كرسي مكتب","MRC EXECUTIVE CHAIRS ALWAYS INSPIRING MORE Office Chair Spare Parts Heavy Duty Gas Lift Hydraulic Pneumatic Shock Cylinder"],
 ["Q30-f","كرسي مكتب","NUOBESTY Retrofit Office Computer Chair Headrest - Adjustable Head Cushion Pillow Attachment"],
 ["Q30-g","كرسي مكتب","LeapYouth Premium Office Chair Mat for Hard Wood Floors, 36 x 48 inches, Clear Floor Protectors for Rolling Chairs"],
 ["Q30-h","كرسي مكتب","ANYUAN Foldable Camping Cot, Portable Recliner Chair for Outdoor & Office Nap, Adjustable Lawn Lounge Bed with Headrest"],
 ["Q32-a","بن قهوة","Mibru v60 pour over premium coffee set of 2 includes coffee server 02 coffee dripper 02, barista tools"],
 ["Q32-b","بن قهوة","The Little Book for Coffee Lovers - All About Coffee"],
 ["Q32-c","بن قهوة","A Treatise on the Nature and Cultivation of Coffee: With Some Remarks on the Management of Coffee Estates"],
 ["Q32-d","بن قهوة","Coffee and Poetry: Make Every Day a Great Day with Coffee"]
];
const positive=[
 ["Dyson V15 vacuum cleaner","Dyson V15 Detect Submarine, Vacuum Cleaner"],
 ["Dyson V15 vacuum cleaner","Dyson V15 Detect Absolute Cordless Vacuum Cleaner, Silver - Middle East Version"],
 ["Dyson V15 replacement hose","Replacement Vacuum Cleaner Hose for Dyson V6 V7 V8 V10 V11 V15"],
 ["Dyson V15 dust bin replacement","Upgraded Dust Bin Replacement for Dyson V15 Vacuum Cleaner"],
 ["office chair","Brim, Office chair"],
 ["كرسي مكتب","Brim,Office chair"],
 ["office chair headrest attachment","Ergonomic Office Chair Headrest Attachment"],
 ["office chair gas lift replacement","Office Chair Spare Parts Heavy Duty Gas Lift Cylinder"],
 ["coffee beans","Premium Arabica Coffee Beans 1kg"],
 ["بن قهوة","Camel Step Coffee Roasters C-Blend 250G BAG"],
 ["coffee dripper","Mibru v60 pour over premium coffee set with coffee dripper and server"],
 ["بن قهوة مقطرة","قهوة مختصة محمصة 250 جرام"],
 ["Apple Watch Series 11","Apple Watch Series 11 GPS Smartwatch 46mm"],
 ["Canon mirrorless camera","Canon EOS R100 Mirrorless Camera 24.1MP"],
 ["PS5 Disc Drive","Sony Disc Drive for PlayStation 5 Digital Edition Slim, White"]
];
const offer=(id,query,title)=>({
 title,brand:query,productType:query,provider:"test_fixture",merchant:"SYNTHETIC_ONLY",
 sourceUrl:"https://fixture.invalid/evidence/"+encodeURIComponent(id),
 productPrice:3333,currency:"SAR",condition:"new",availability:"in_stock",specs:{},
 observedAt:"2026-11-02T00:00:00.000Z",
});
for(const [id,query,title] of negative){
 test("R04 P3 observed retail-subject mismatch "+id,()=>{
  const a=offer(id,query,title);
  const match=assessOfferMatch(query,a);
  assert.equal(match.exactMatch,false,id+" false exact match "+title);
  assert.equal(filterQueryOffers(query,[a]).offers.length,0,id+" false principal admission");
 });
}
test("R04 P3: complete principals and explicit accessory queries remain discoverable",()=>{
 for(const [query,title] of positive){
  const item=offer(query,query,title);
  const match=assessOfferMatch(query,item);
  assert.ok(match.matchConfidence>=0.65,query+" -> "+title+": "+JSON.stringify(match));
 }
});
