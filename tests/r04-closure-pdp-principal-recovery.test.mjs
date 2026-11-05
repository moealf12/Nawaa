import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPresentableStorefrontPrincipal,selectStorefrontRecoveryLinks,
} from "../server/providers/free-storefronts.mjs";

const offer=(title,extras={})=>({
  title,merchant:"Merchant",productPrice:1200,currency:"SAR",
  sourceUrl:"https://store.example/p/iphone",condition:"new",
  availability:"in_stock",exactMatch:false,matchConfidence:0.92,
  specs:{},...extras,
});
const links=[
  {url:"https://store.example/p/apple-iphone-17-256gb",label:"Apple iPhone 17 256GB"},
  {url:"https://store.example/p/apple-iphone-17-512gb",label:"Apple iPhone 17 512GB"},
  {url:"https://store.example/p/apple-iphone-16",label:"Apple iPhone 16"},
];

test("R04 closure: related cards cannot suppress a bounded PDP principal recovery",()=>{
  const source=[offer("iPhone 17 protective phone case"),offer("iPhone 17 repair kit")];
  assert.equal(hasPresentableStorefrontPrincipal("iPhone 17",source),false);
  const plan=selectStorefrontRecoveryLinks({
    query:"iPhone 17",directOffers:source,links,pageLimit:99,
    hadStructuredCards:true,
  });
  assert.equal(plan.reason,"DIRECT_ALL_REJECTED");
  assert.equal(plan.links.length,2);
  assert.equal(plan.pageBudget,2);
  assert.ok(plan.links.every(x=>!x.url.includes("iphone-16")));
});

test("R04 closure: real principal prevents wasted PDP fanout",()=>{
  const original=offer("Apple iPhone 17 256GB Black");
  assert.equal(hasPresentableStorefrontPrincipal("iPhone 17",[original]),true);
  const plan=selectStorefrontRecoveryLinks({
    query:"iPhone 17",directOffers:[original],links,pageLimit:2,hadStructuredCards:true});
  assert.equal(plan.reason,"DIRECT_MATCHES_RETAINED");
  assert.deepEqual(plan.links,[]);
});

test("R04 closure: forged match flags cannot convert parts or cross-models into principal",()=>{
  const bad=[
    offer("iPhone 17 case cover",{exactMatch:true,matchConfidence:1}),
    offer("Apple iPhone 16 256GB Black",{exactMatch:true,matchConfidence:1}),
    offer("Apple iPhone 17 256GB Black",{condition:"unknown",exactMatch:true,matchConfidence:1}),
    offer("Apple iPhone 17 256GB Black",{condition:"used",exactMatch:true,matchConfidence:1}),
  ];
  assert.equal(hasPresentableStorefrontPrincipal("iPhone 17",bad),false);
  assert.equal(hasPresentableStorefrontPrincipal("iPhone 17 used",[bad[3]]),true);
});

test("R04 closure: blocked acquisition and zero budget remain hard-stops",()=>{
  const cards=[offer("iPhone 17 leather case")];
  const denied=selectStorefrontRecoveryLinks({
    query:"iPhone 17",directOffers:cards,links,pageLimit:2,
    hadStructuredCards:true,searchBlocked:true});
  assert.equal(denied.reason,"ACQUISITION_BLOCKED");
  assert.equal(denied.attempted,0);
  const zero=selectStorefrontRecoveryLinks({
    query:"iPhone 17",directOffers:cards,links,pageLimit:0,hadStructuredCards:true});
  assert.equal(zero.reason,"BUDGET_DISABLED");
  assert.equal(zero.attempted,0);
});

test("R04 closure: source probing does not mutate original evidence",()=>{
  const cards=[offer("iPhone 17 spare charger")];
  const before=JSON.stringify(cards);
  hasPresentableStorefrontPrincipal("iPhone 17",cards);
  selectStorefrontRecoveryLinks({
    query:"iPhone 17",directOffers:cards,links,pageLimit:2,hadStructuredCards:true});
  assert.equal(JSON.stringify(cards),before);
});

test("R04 closure: both selection and HTML-link scan use the same strict principal gate",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
  assert.match(source,/if\(hasPresentableStorefrontPrincipal\(query,directOffers\)\)/);
  assert.match(source,/const hasMatchingDirectOffers=hasPresentableStorefrontPrincipal\(/);
  assert.match(source,/const resolutionLinks = !amazonDePriceHold\.customerPublishable/);
  assert.match(source,/const pageBudget=Math\.max\(0,Math\.min\(2,/);
});
