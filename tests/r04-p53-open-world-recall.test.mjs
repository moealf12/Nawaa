import test from "node:test";
import assert from "node:assert/strict";
import {inspectFirstPassRecall,planOpenWorldStorefrontBackfill}
 from "../server/open-world-recall-policy.mjs";
import {acquisitionPlan} from "../server/search-cursor.mjs";
const offer=(title,opts={})=>({
  title,merchant:"jarir",productPrice:1000,currency:"SAR",condition:"new",
  availability:"in_stock",sourceUrl:"https://example.com/p/one",
  exactMatch:true,matchConfidence:1,
  specs:{brand:"Apple",deviceType:"iPhone 17",storage:"256GB"},
  ...opts,
});

test("R04 open-world: 25 merely-related accessory offers never suppress strict recall",()=>{
  const variants=Array.from({length:25},(_,i)=>offer(
    "iPhone 17 protective phone case cover "+i,
    {merchant:"shop"+i,exactMatch:false,matchConfidence:.78,
      sourceUrl:"https://example.com/cases/"+i}));
  const original=JSON.stringify(variants);
  const result=inspectFirstPassRecall("iPhone 17",variants);
  assert.equal(result.weakRelatedCount,25);
  assert.equal(result.strictPrincipalObserved,0);
  assert.equal(result.needsExpansion,true);
  assert.equal(result.reason,"NO_VERIFIED_PRESENTABLE_PRINCIPAL");
  assert.equal(JSON.stringify(variants),original);
});

test("R04 open-world: genuine principal stops redundant zero-principal backfill",()=>{
  const variants=Array.from({length:30},(_,i)=>offer("iPhone 17 Protective Case "+i,{
    exactMatch:false,matchConfidence:.7,merchant:"store"+i}));
  variants.push(offer("Apple iPhone 17 256GB Black",{merchant:"apple"}));
  const out=inspectFirstPassRecall("iPhone 17",variants);
  assert.ok(out.strictPrincipalObserved>=1,JSON.stringify(out));
  assert.equal(out.needsExpansion,false);
  assert.equal(out.reason,"FIRST_WAVE_SUFFICIENT");
});

test("R04 open-world: used, unknown, unrelated accessories and variant mismatch do not certify new principals",()=>{
  for(const source of [
    offer("Apple iPhone 17 256GB Black",{condition:"unknown"}),
    offer("Apple iPhone 17 256GB Black",{condition:"used"}),
    offer("iPhone 17 Camera Protection Case",{exactMatch:true,matchConfidence:1}),
    offer("Apple iPhone 16 256GB Black",{exactMatch:true,matchConfidence:1}),
  ]){
    const a=inspectFirstPassRecall("iPhone 17",[source]);
    assert.equal(a.strictPrincipalObserved,0,JSON.stringify(source));
    assert.equal(a.needsExpansion,true);
  }
});

test("R04 open-world: one true principal can still expand when merchant breadth insufficient",()=>{
  const out=inspectFirstPassRecall("iPhone 17",[
    offer("Apple iPhone 17 256GB Black",{merchant:"jarir"}),
  ]);
  assert.ok(out.strictPrincipalObserved>=1);
  assert.equal(out.needsExpansion,true);
  assert.equal(out.reason,"INSUFFICIENT_RELATED_RECALL");
});

test("R04 open-world: unseen query vocabulary triggers bounded disjoint source window",()=>{
  const queries=[
    "حقائب سفر يدوية",
    "أداة خراطة الخشب حرفية",
    "التوربين الصغير LZ-701",
    "robotics inspection microscope 40x",
    "guitar pedal reverb under 200",
    "garden irrigation brass valve 18mm",
    "mesa auxiliar vintage artesanal",
    "rakieta do badmintona",
    "mouture de café manuelle",
    "pillow cover bamboo",
  ];
  for(const q of queries){
    assert.equal(inspectFirstPassRecall(q,Array.from({length:30},(_,i)=>
      offer("generic compatible item "+i,{exactMatch:false,matchConfidence:.8}))).needsExpansion,true,q);
    const plan=planOpenWorldStorefrontBackfill(q,53,{firstWaveStorefrontLimit:16});
    assert.ok(plan,q);
    const primary=acquisitionPlan(0,53);
    assert.ok(plan.storeOffset>=primary.storefrontOffset+primary.storefrontLimit,q);
    assert.ok(plan.storeLimit<=6);
    assert.ok(plan.productPageLimit<=2);
    assert.ok(plan.storeDeadlineMs<=3500);
    assert.equal(plan.sourceEvidence,"OPEN_WORLD_DISJOINT_STOREFRONTS");
  }
});

test("R04 open-world: no same-store retries where registry has no deeper window",()=>{
  assert.equal(planOpenWorldStorefrontBackfill("laptop",16),null);
  assert.equal(planOpenWorldStorefrontBackfill("laptop",1),null);
  assert.equal(planOpenWorldStorefrontBackfill("   ",53),null);
  assert.equal(planOpenWorldStorefrontBackfill("laptop",53,{firstWaveStorefrontLimit:8}),null);
  assert.equal(inspectFirstPassRecall("  ",[]).needsExpansion,false);
});

test("R04 open-world: 3000 mixed related candidates cannot cause unbounded principal grouping",()=>{
  const offers=Array.from({length:3000},(_,i)=>offer("iPhone 17 matching "+i,{
    exactMatch:i%2===0,matchConfidence:i%2===0?1:.7,
    sourceUrl:"https://example.com/"+i,
  }));
  const out=inspectFirstPassRecall("iPhone 17",offers);
  assert.equal(out.verifiedCandidateTotal,1500);
  assert.equal(out.strictProbeTruncated,true);
  assert.ok(out.strictPrincipalObserved>=0);
  assert.equal(out.weakRelatedCount,3000);
});

test("R04 open-world: returns bounded counters, never raw query, product titles, prices or merchant URLs",()=>{
  const a=inspectFirstPassRecall("private secret query 777",[
    offer("PRIVATE_PRODUCT_SECRET",{exactMatch:false,matchConfidence:.78,
      sourceUrl:"https://private.example/token=secret",merchant:"SECRET_MERCHANT"}),
  ]);
  const s=JSON.stringify(a);
  for(const phrase of ["PRIVATE_PRODUCT_SECRET","private secret query 777","private.example","SECRET_MERCHANT"])
    assert.equal(s.includes(phrase),false);
});
