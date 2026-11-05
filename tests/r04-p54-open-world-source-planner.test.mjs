import test from "node:test";
import assert from "node:assert/strict";
import {planUnknownCategorySpecialists}
 from "../server/open-world-source-planner.mjs";
import {planFreeStorefrontSpecialistBackfill,routeFreeStorefronts}
 from "../server/providers/free-storefronts.mjs";

const sources=[
 {id:"audio-shop",categories:["audio"]},
 {id:"books-shop",categories:["book"]},
 {id:"tools-shop",categories:["tool"]},
 {id:"kitchen-shop",categories:["kitchen"]},
 {id:"fashion-shop",categories:["clothing","shoes"]},
 {id:"home-shop",categories:["home","furniture"]},
 {id:"beauty-shop",categories:["beauty","perfume"]},
 {id:"general-shop",categories:["*"]},
];

test("P54: unknown-category queries explore registered specialists without product word exceptions",()=>{
  const sample=["اجهزة تنظيف للمستودعات","unknown sensor MXL-42",
    "professor's archival map", "robotic adhesive dispenser",
    "carbon polymer RF111","artesanias de madera", "café biologique",
    "intercambio de accesorios 47mm","生物陶瓷 电池",
    "archival vellum apparatus"];
  let covered=0;
  for(const query of sample){
    const p=planUnknownCategorySpecialists({query,stores:sources,maxStores:4});
    assert.equal(p.storeIds.length,4,query);
    assert.equal(p.reason,"CATEGORY_DIVERSITY_EXPLORATION");
    assert.equal(new Set(p.storeIds).size,4);
    for(const id of p.storeIds)assert.ok(sources.some(s=>s.id===id&&s.categories[0]!=="*"));
    assert.deepEqual(p,planUnknownCategorySpecialists({query,stores:sources,maxStores:4}));
    covered+=p.chosenBuckets;
  }
  assert.ok(covered>=sample.length*3);
});

test("P54: never use an unseen hostname, a previously searched source, or a denied source",()=>{
  const blocked=["audio-shop","books-shop"];
  const p=planUnknownCategorySpecialists({
    query:"unknown custom product MXL-42",stores:[
      ...sources,{id:"evil:source",categories:["tool"]},
      {id:"sneaky",categories:["totally_invented"]},
    ],
    alreadySearchedIds:blocked,excludedStoreIds:["tools-shop"],
    maxStores:6,
  });
  assert.ok(p.storeIds.length>0);
  for(const id of [...blocked,"tools-shop","evil:source","sneaky"])
    assert.ok(!p.storeIds.includes(id),id);
  assert.equal(new Set(p.storeIds).size,p.storeIds.length);
});

test("P54: zero budget, recognized categories, recognized brands and empty input never add sources",()=>{
  for(const query of ["iphone 17 256gb","laptop","ps5 digital",
    "apple","swarovski necklace"]){
    const p=planUnknownCategorySpecialists({query,stores:sources});
    assert.equal(p.reason,"CLASSIFIED_QUERY",query);
    assert.deepEqual(p.storeIds,[]);
  }
  const zero=planUnknownCategorySpecialists({
    query:"unknown custom model zrx-12",stores:sources,maxStores:0,
  });
  assert.equal(zero.reason,"BUDGET_DISABLED");
  assert.deepEqual(zero.storeIds,[]);
  assert.deepEqual(planUnknownCategorySpecialists({query:" ",stores:sources}).storeIds,[]);
});

test("P54: real first-wave storefronts and specialist backfill are disjoint",()=>{
  const q="أداة نحت خشب يدوية";
  const base=routeFreeStorefronts(q,Infinity,{stable:true})
    .filter(r=>!["amazon-sa","virgin-ae"].includes(r.store.id))
    .slice(0,16).map(r=>r.store.id);
  const p=planFreeStorefrontSpecialistBackfill(q,{
    firstWaveStoreLimit:16,maxStores:6,excludedStoreIds:["aliexpress-cn"],
  });
  assert.ok(p.storeIds.length>0,JSON.stringify(p));
  assert.ok(p.storeIds.length<=6);
  assert.ok(p.storeIds.every(id=>!base.includes(id)&&
    !["amazon-sa","virgin-ae","aliexpress-cn"].includes(id)));
  assert.deepEqual(p,planFreeStorefrontSpecialistBackfill(q,{
    firstWaveStoreLimit:16,maxStores:6,excludedStoreIds:["aliexpress-cn"],
  }));
});

test("P54: all prior known-category routes remain unchanged, including priority and reachability",()=>{
  for(const q of ["iPhone 17 256GB","PS5 Digital Edition","headphones",
    "jewelry","running shoes","toys"]){
    const before=routeFreeStorefronts(q,24,{stable:true}).map(x=>x.store.id);
    const p=planFreeStorefrontSpecialistBackfill(q,{maxStores:6});
    assert.deepEqual(p.storeIds,[],q);
    assert.deepEqual(routeFreeStorefronts(q,24,{stable:true}).map(x=>x.store.id),before);
  }
});

test("P54: all unknown-source planning is deterministic without raw query, price, title or URL logging",()=>{
  const q="SECRET_PRIVATE_QUERY_987 custom 22cm";
  const p=planUnknownCategorySpecialists({query:q,stores:sources,maxStores:5});
  const encoded=JSON.stringify(p);
  assert.ok(!encoded.includes("SECRET_PRIVATE_QUERY_987"));
  assert.ok(!encoded.includes("22cm"));
  assert.ok(encoded.length<600);
});

test("P54: no source registry fanout or unbounded per-query allocations at scale",()=>{
  const large=Array.from({length:500},(_,i)=>({
    id:"merchant-"+i,categories:["tool","kitchen","audio","home"],
  }));
  const p=planUnknownCategorySpecialists({query:"unfamiliar apparatus JKL-123",stores:large,maxStores:9999});
  assert.ok(p.storeIds.length<=6);
  assert.equal(new Set(p.storeIds).size,p.storeIds.length);
  assert.throws(()=>planUnknownCategorySpecialists({
    query:"unfamiliar apparatus JKL-123",stores:[...large,large[0]],maxStores:6,
  }),/INVALID_SOURCE_REGISTRY/);
});

test("P54: both real client paths use the same source planning, without touching ranking or shopper evidence",async()=>{
  const {readFileSync}=await import("node:fs");
  const server=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  const provider=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
  assert.equal(server.split("exploreUnknownSpecialists:true").length-1,2);
  assert.match(provider,/planFreeStorefrontSpecialistBackfill\(query/);
  assert.match(provider,/maxStores:storeLimit/);
  assert.match(server,/matchingQuery:query/);
});
