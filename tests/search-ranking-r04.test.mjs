import test from "node:test";
import assert from "node:assert/strict";
import {compareOffers,selectDiverseOffers} from "../server/offer-selection.mjs";

// Synthetic evaluation fixtures only, never live merchant price evidence.
const listing=(id,price,confidence,overrides={})=>({
  provider:"jarir-direct",providerMarket:"jarir-sa",merchant:"Jarir",
  title:"Apple iPhone 17 256 GB",sourceUrl:"https://www.jarir.com/sa-en/item-"+id,
  productPrice:price,currency:"SAR",exactMatch:true,matchConfidence:confidence,
  ...overrides,
});

test("R04 RED: near-equivalent SAME-CURRENCY exact variant ranks lower price first",()=>{
  const moreExpensive=listing("a",3999,0.99);
  const cheaper=listing("b",3599,0.98);
  assert.ok(compareOffers(cheaper,moreExpensive)<0,
    "0.01 confidence difference is not material enough to hide SAR 400 saving");
  assert.equal(selectDiverseOffers([moreExpensive,cheaper],2)[0].productPrice,3599);
});

test("R04: material 0.20 confidence gap dominates suspicious low price",()=>{
  const strong=listing("strong",3999,.99);
  const weak=listing("weak",99,.79);
  assert.ok(compareOffers(strong,weak)<0);
  assert.equal(selectDiverseOffers([weak,strong],2)[0].productPrice,3999);
});

test("R04 RED: never rank raw prices across different currencies as comparable",()=>{
  const sar=listing("sar",3500,.98);
  const eur=listing("eur",700,.98,{currency:"EUR",merchant:"International",provider:"eu-store"});
  assert.equal(compareOffers(sar,eur),0,
    "same confidence and different currencies have no grounded price ordering");
});

test("R04: exact device keeps precedence over cheap accessory",()=>{
  const phone=listing("phone",3999,.91);
  const caseCover=listing("case",50,.99,{title:"Case compatible with iPhone 17",exactMatch:false});
  const sorted=selectDiverseOffers([caseCover,phone],2);
  assert.equal(sorted[0].title,phone.title);
});

test("R04: absent price must never be treated as zero",()=>{
  const verified=listing("verified",3599,.98);
  const without=listing("missing",undefined,.98);
  assert.ok(compareOffers(verified,without)<0);
});

test("R04: mixed-currency merchant cohort stays confidence-ordered across arrival permutations",()=>{
  const a=listing("a",4500,.99);
  const b=listing("b",650,.98,{currency:"EUR"});
  const c=listing("c",2800,.97);
  for(const permutation of [[a,b,c],[a,c,b],[b,a,c],[b,c,a],[c,a,b],[c,b,a]]){
    assert.deepEqual(selectDiverseOffers(permutation,3).map(o=>o.sourceUrl),
      [a,b,c].map(o=>o.sourceUrl),
      "never create a nontransitive raw-price ordering across currencies");
  }
});
