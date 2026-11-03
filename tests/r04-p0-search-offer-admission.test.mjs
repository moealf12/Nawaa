import test from "node:test";
import assert from "node:assert/strict";
import {createSearchOfferAdmission} from "../server/search-offer-admission.mjs";
import {selectDiverseOffers} from "../server/offer-selection.mjs";
import {buildIntentAwareResultLanes} from "../src/search-result-intelligence.mjs";

const offer=(title,score,extra={})=>({
  merchant:"Fixture",provider:"fixture",currency:"SAR",productPrice:100,
  title,matchConfidence:score,exactMatch:false,
  sourceUrl:"https://fixture.invalid/offer",condition:"new",...extra,
});
const asGroup=(o,key)=>({key,offers:[o],bestOffer:o});

test("R04 P0: preserve below-0.35 title-evidenced related offers for any query",()=>{
  const fixtures=[
    ["iPhone 17","Protective Case for Apple iPhone 17 Pro",.12],
    ["PS5","Replacement Disc Drive Parts for PS5 Console",.02],
    ["Dyson V15","Replacement Filter for Dyson V15",.08],
    ["Canon mirrorless camera","Canon Camera Lens for Canon Mirrorless Camera",.12],
    ["Apple Watch Series 11","Replacement Watch Strap for Apple Watch Series 11",.12],
    ["coffee beans","Coffee Beans Grinder Cleaning Brush",.2],
    ["JBL headphones","JBL Headphones Replacement Ear Cushions",.2],
    ["HP laptop","HP Laptop Charger 65W",.15],
    ["سوار ساعة","سوار ساعة ذكية",.1],
    ["Dior","Christian Dior Fragrance Guide",.1],
  ];
  for(const [q,title,score] of fixtures)
    assert.equal(createSearchOfferAdmission(q)(offer(title,score)),true,q+" / "+title);
});

test("R04 P0: no weak rescue via cheap price, seller, brand or SEO link",()=>{
  const admit=createSearchOfferAdmission("Dyson V15");
  assert.equal(admit(offer("Toy Vacuum Machine",.2,{
    brand:"Dyson",merchant:"Dyson V15",productPrice:0.01,
    sourceUrl:"https://fixture.invalid/dyson/v15"})),false);
  assert.equal(admit(offer("Dyson Vacuum Toy",.2)),false,
    "one out of two query tokens cannot rescue broad weak results");
  assert.equal(admit(offer("Dyson V15 replacement filter",.2)),true);
});

test("R04 P0: malformed score cannot be laundered into discoverability",()=>{
  const admit=createSearchOfferAdmission("iPhone 17");
  for(const score of [null,undefined,NaN,Infinity,-Infinity,-1,1.1,"0.9"])
    assert.equal(admit(offer("Apple iPhone 17",score)),false,String(score));
  assert.equal(admit(offer("Unrelated item",.8)),true,
    "existing strong-score eligibility is preserved; upstream matcher owns evidence quality");
  assert.equal(admit(offer("",.1)),false);
});

test("R04 P0: the old high-confidence set is a strict subset of admitted items",()=>{
  const items=Array.from({length:3000},(_,i)=>offer(
    i%3===0?"Sony PS5 Disc Console":i%3===1?"PS5 Replacement Disc Drive":"Unrelated Toys",
    i%3===0?.95:i%3===1?.15:0,{sourceUrl:"https://fixture.invalid/"+i}));
  const admit=createSearchOfferAdmission("PS5");
  assert.equal(items.filter(x=>x.matchConfidence>=.35).length,1000);
  assert.equal(items.filter(admit).length,2000);
  assert.equal(items.filter(x=>x.matchConfidence>=.35 && !admit(x)).length,0);
});

test("R04 P0: lower-confidence accessories remain secondary and cannot beat exact products",()=>{
  const exact=offer("Sony PS5 Slim Disc Console",1,{exactMatch:true,merchant:"Official",productPrice:3000});
  const related=offer("PS5 Disc Drive Replacement",.12,{merchant:"Peripheral",productPrice:1});
  const eligible=[related,exact].filter(createSearchOfferAdmission("PS5"));
  const ordered=selectDiverseOffers(eligible,120);
  assert.equal(ordered[0],exact,"1 SAR replacement is not a 1 SAR PS5 console");
  const lanes=buildIntentAwareResultLanes("PS5",ordered.map((o,i)=>asGroup(o,"key-"+i)));
  assert.equal(lanes.primaryGroups.length,1);
  assert.equal(lanes.secondarySections.flatMap(x=>x.groups).length,1);
  assert.equal(lanes.partitionedGroups,2);
});
