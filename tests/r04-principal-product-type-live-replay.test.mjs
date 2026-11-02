import test from "node:test";
import assert from "node:assert/strict";
import {assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

const evidence=[
  ["Q19","Canon mirrorless camera","Canon EF 50MM f/1.8 STM Prime Lens, for Canon DSLR Camera"],
  ["Q19b","Canon mirrorless camera","Camera Hand Strap Wrist Strap for Canon EOS DSLR Mirrorless Camera"],
  ["Q21","Dyson V15 vacuum cleaner","My Happy Childhood Home - Vacuum Cleaner Kid's Pretend Play, 5 Years and Above"],
  ["Q29","office chair","Model Miniature Furnitures, Office Set: Desk;Cabinet;Chair, 1:100, 3 Pieces"],
  ["Q30","كرسي مكتب","YelaJoy Office Chair Sagging Fix Clamp Height-Lock Bracket"],
  ["Q31","coffee beans","MIBRU A small spray to moisturize the coffee beans before grinding 30ml Empty Makeup Sprayer"],
  ["Q32","بن قهوة","3D Stickers, Coffee: Cup Brown, 1 Piece"],
  ["Q33","Apple Watch Series 11","Compatible with Apple Watch Strap Braided Sport Loop Band for Series 11"],
  ["Q07","PS5 Disc Drive","PlayStation 5 Disc Drive Empty Shell Optical Drive Housing Replacement Part"],
];

const offer=(title,n)=>({
  title,provider:"fixture",providerMarket:"qa",merchant:"Observed merchant",
  sourceUrl:"https://evidence.example/p/"+n,productPrice:1299,currency:"SAR",
  condition:"new",availability:"in_stock",observedAt:"2026-11-02T00:00:00Z",
  specs:{}
});
test("R04 P1: real recorded accessory/toy/repair titles never exact-match the requested complete item",()=>{
  for(const [id,query,title] of evidence){
    const candidate=offer(title,id);
    const m=assessOfferMatch(query,candidate);
    assert.equal(m.exactMatch,false,`${id}: ${title} wrongly exact-matched ${query}`);
    assert.equal(filterQueryOffers(query,[candidate]).offers.length,0,
      `${id}: excluded independently observed wrong principal type`);
  }
});
test("R04 P1: genuine completed devices and retail goods remain eligible",()=>{
  const positives=[
    ["Canon mirrorless camera","Canon EOS R50 Mirrorless Camera Body",1],
    ["Dyson V15 vacuum cleaner","Dyson V15 Cordless Vacuum Cleaner",2],
    ["office chair","Ergonomic Office Chair High Back Full Size",3],
    ["coffee beans","Premium Arabica Coffee Beans 1kg Whole Beans",4],
    ["Apple Watch Series 11","Apple Watch Series 11 GPS Smartwatch 42mm with Sport Band",5],
  ];
  for(const [query,title,n] of positives){
    const candidate=offer(title,"principal-"+n);
    const m=assessOfferMatch(query,candidate);
    assert.ok(m.matchConfidence>=.65,`${query}: valid retail item unexpectedly demoted ${JSON.stringify(m)}`);
    assert.equal(filterQueryOffers(query,[candidate]).offers.length,1,`${query}: must retain evidenced principal`);
  }
});
test("R04 P1: explicit accessory shopping intent is preserved",()=>{
  const intended=[
    ["Canon 50mm lens","Canon EF 50MM f/1.8 STM Prime Lens, for Canon DSLR Camera"],
    ["Apple Watch strap","Compatible with Apple Watch Strap Braided Sport Loop Band for Series 11"],
    ["office chair clamp","YelaJoy Office Chair Sagging Fix Clamp Height-Lock Bracket"],
    ["coffee beans sprayer","MIBRU Coffee Beans Sprayer, Empty Spray Bottle for Grinder"],
    ["camera hand strap","Camera Hand Strap Wrist Strap for Canon EOS DSLR Mirrorless Camera"],
  ];
  for(let i=0;i<intended.length;i++){
    const [query,title]=intended[i];
    const m=assessOfferMatch(query,offer(title,"accessory-"+i));
    assert.ok(m.matchConfidence>=.65,`retail accessory intent ${query}: ${JSON.stringify(m)}`);
    assert.ok(filterQueryOffers(query,[offer(title,"accessory-"+i)]).offers.length>0,`accessory hidden: ${query}`);
  }
});
test("R04 P1: a retail bundle with the advertised principal body and included part is not a standalone accessory",()=>{
  const pairs=[
    ["Canon mirrorless camera","Canon EOS R50 Mirrorless Camera with RF-S18-45mm Lens"],
    ["Apple Watch Series 11","Apple Watch Series 11 GPS with Sport Band"],
    ["office chair","Ergonomic Office Chair with Replacement Caster Wheel Set Included"],
  ];
  for(const [query,title] of pairs){
    assert.equal(filterQueryOffers(query,[offer(title,title)]).offers.length,1,
      `complete product with included extra not a standalone accessory: ${title}`);
  }
});
test("R04 P1: exclusion is query-specific and does not mutate merchant offers or historical evidence",()=>{
  const examples=evidence.map(([id,,title])=>offer(title,id));
  const originals=structuredClone(examples);
  for(const [,query] of evidence)filterQueryOffers(query,examples);
  assert.deepStrictEqual(examples,originals);
});

test("R04 P1: EOS R compatibility in a sold lens is not evidence of an actual camera body",()=>{
  const title="Canon EOS R5 compatible lens RF 50mm for mirrorless camera";
  const item=offer(title,"eos-lens");
  assert.equal(assessOfferMatch("Canon mirrorless camera",item).exactMatch,false);
  assert.equal(filterQueryOffers("Canon mirrorless camera",[item]).offers.length,0);
  assert.equal(filterQueryOffers("Canon camera lens",[item]).offers.length,1,
    "explicit lens search must keep the same retail item");
});
test("R04 P1: an EOS mirrorless retail camera kit containing a lens stays a camera",()=>{
  const title="Canon EOS R50 Mirrorless Camera Lens Kit";
  const item=offer(title,"camera-kit");
  assert.equal(filterQueryOffers("Canon mirrorless camera",[item]).offers.length,1);
});
