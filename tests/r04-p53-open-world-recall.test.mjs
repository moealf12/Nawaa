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

test("R04 open-world: Arabic/English new, used and renewed buyer conditions are exact contracts",async()=>{
  const {parseSearchIntent}=await import("../src/search-query.mjs");
  const samples=[
    ["ايفون 17 مجدد","refurbished"],
    ["ايفون 17 مجددة","refurbished"],
    ["iPhone 17 renewed","refurbished"],
    ["iPhone 17 refurbished","refurbished"],
    ["ايفون 17 مستعمل","used"],
    ["laptop used","used"],
    ["سماعات جديد","new"],
    ["headphones new","new"],
  ];
  for(const [query,condition] of samples){
    const intent=parseSearchIntent(query);
    assert.equal(intent.condition,condition,query);
    for(const raw of ["مجدد","مجدده","renewed","refurbished",
      "مستعمل","مستعمله","used","جديد","جديده","new"])
      assert.equal((" "+intent.providerQuery+" ").includes(" "+raw+" "),false,
        query+" leaked condition keyword into merchant acquisition");
  }
  const present=offer("Apple iPhone 17 256GB Renewed",{
    condition:"refurbished",merchant:"jarir",
  });
  const d=inspectFirstPassRecall("ايفون 17 مجدد",[present]);
  assert.ok(d.strictPrincipalObserved>=1,JSON.stringify(d));
  // A merely related low-confidence pile cannot change requested condition.
  const unproven=inspectFirstPassRecall("ايفون 17 مجدد",[
    offer("Apple iPhone 17 256GB New",{condition:"new"}),
  ]);
  assert.equal(unproven.strictPrincipalObserved,0);
});

test("R04 open-world: contradictory buyer condition never guesses new or used",async()=>{
  const {parseSearchIntent}=await import("../src/search-query.mjs");
  const q="iphone 17 used new";
  const parsed=parseSearchIntent(q);
  assert.equal(parsed.condition,null);
  assert.equal(parsed.providerQuery,"iphone 17 used new");
});

test("R04 universal: canonical merchant condition aliases are normalized before identity and presentation",async()=>{
  const {dedupeNormalizedOffers}=await import("../server/match.mjs");
  const raw=offer("Apple iPhone 17 Renewed",{
    condition:"renewed",provider:"jarir-direct",
    sourceUrl:"https://www.jarir.com/sa-en/apple-iphone-17-123.html",
  });
  const untouched=JSON.stringify(raw);
  const rows=dedupeNormalizedOffers([raw]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].condition,"refurbished");
  assert.equal(raw.condition,"renewed");
  assert.equal(JSON.stringify(raw),untouched);
  const certified=inspectFirstPassRecall("ايفون 17 مجدد",rows);
  assert.ok(certified.strictPrincipalObserved>=1,JSON.stringify(certified));
  const other=dedupeNormalizedOffers([
    raw,{...raw,condition:"new"},{...raw,condition:"used"},
    {...raw,condition:"unknown"},
  ]);
  assert.equal(other.length,4,
    "canonical condition must never fuse new, refurbished, used, unknown");
  for(const condition of ["new","refurbished","used","unknown"])
    assert.ok(other.some(o=>o.condition===condition));
});

test("R04 open-world: both JSON and SSE search paths use the same safe recall decision",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  assert.equal(source.split("inspectFirstPassRecall(query,").length-1,2);
  assert.equal(source.split("planOpenWorldStorefrontBackfill(query,").length-1,2);
  assert.match(source,/streamDeadlineAt-Date\.now\(\)>2200/);
  assert.match(source,/streamBackfillBudgetExpired\?null:providersPending/);
  assert.match(source,/const fallbackSignal=AbortSignal\.any/);
  assert.match(source,/const backfillSignal=AbortSignal\.any/);
  assert.match(source,/streamBackfillMode="disjoint_storefronts"/);
});
