import test from "node:test";
import assert from "node:assert/strict";
import {planUnknownCategorySpecialists} from "../server/open-world-source-planner.mjs";

const available=[
  {id:"audio-a",categories:["audio"]},
  {id:"book-a",categories:["book"]},
  {id:"tool-a",categories:["tool"]},
  {id:"kitchen-a",categories:["kitchen"]},
  {id:"home-a",categories:["home"]},
  {id:"pet-a",categories:["pet"]},
  {id:"beauty-a",categories:["beauty"]},
  {id:"camera-a",categories:["camera"]},
];
const good={attempts:12,transportSuccessRate:0.98,productiveRate:0.95,coolingDown:false};
const poor={attempts:12,transportSuccessRate:0.1,productiveRate:0.04,coolingDown:false};

test("P55: observed productive access wins across category buckets for unclassified queries",()=>{
  const health=Object.fromEntries(available.map(s=>[s.id,poor]));
  health["tool-a"]=good;
  health["pet-a"]={...good,transportSuccessRate:0.95};
  for(const query of ["صمام تحكم مخبري QZ191","unfamiliar compound accessory JKL123",
    "equipo artesanal industrial","非标准 工业 装置"]){
    const p=planUnknownCategorySpecialists({query,stores:available,maxStores:2,sourceHealth:health});
    assert.deepEqual(new Set(p.storeIds),new Set(["tool-a","pet-a"]),query);
    assert.equal(p.chosenBuckets,2);
    assert.equal(p.storeIds.length,2);
  }
});

test("P55: blocked or cooling-down stores never consume exploration budget",()=>{
  const p=planUnknownCategorySpecialists({query:"custom nonstandard fixture HK115",
    stores:available,maxStores:6,
    excludedStoreIds:["tool-a"],
    sourceHealth:{"audio-a":{...good,coolingDown:true},"book-a":good,"pet-a":good}});
  assert.ok(!p.storeIds.includes("tool-a"));
  assert.ok(!p.storeIds.includes("audio-a"));
  assert.equal(new Set(p.storeIds).size,p.storeIds.length);
  assert.ok(p.storeIds.length<=6);
});

test("P55: fewer than three attempts do not create fabricated merchant confidence",()=>{
  const health={"audio-a":{...good,attempts:2},"book-a":{...poor,attempts:1}};
  const a=planUnknownCategorySpecialists({query:"rare apparatus ZY157",
    stores:available,maxStores:6,sourceHealth:health});
  const b=planUnknownCategorySpecialists({query:"rare apparatus ZY157",
    stores:available,maxStores:6});
  assert.deepEqual(a.storeIds,b.storeIds);
});

test("P55: categorised known terms remain on the established route",()=>{
  for(const query of ["iPhone 17 256GB","laptop","سماعات بلوتوث","PS5 Digital Edition","jewelry"]){
    const result=planUnknownCategorySpecialists({query,stores:available,maxStores:6,
      sourceHealth:{"tool-a":good,"audio-a":good}});
    assert.equal(result.reason,"CLASSIFIED_QUERY",query);
    assert.deepEqual(result.storeIds,[]);
  }
});

test("P55: 500 merchants, duplicate categories, and massive budgets stay bounded",()=>{
  const stores=Array.from({length:500},(_,i)=>({
    id:"merchant-"+i,categories:["home","book","tool","home"]}));
  const result=planUnknownCategorySpecialists({query:"unknown nonstandard batch SKU742",
    stores,maxStores:10**8});
  assert.ok(result.storeIds.length<=6);
  assert.equal(new Set(result.storeIds).size,result.storeIds.length);
  assert.equal(result.categoryBuckets,3);
  assert.doesNotMatch(JSON.stringify(result),/unknown nonstandard|SKU742/);
});
