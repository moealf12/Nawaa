import test from "node:test";
import assert from "node:assert/strict";
import {groupComparableOffers, buildVariantSelectorState} from "../src/search-core.mjs";
import {mergeComparisonOffers} from "../src/search-query.mjs";

const phone=(merchant,overrides={})=>({
  merchant,
  title:"Apple iPhone 17 Pro 256GB Cosmic Orange",
  sourceUrl:`https://merchant.example/${merchant.toLowerCase().replace(/ /g,"-")}`,
  productPrice: merchant === "Jarir" ? 4900 : 4600,
  condition:"new",availability:"in_stock",canShipToSaudi:true,
  exactMatch:true,matchConfidence:1,shipping:null,
  specs:{brand:"Apple",deviceType:"iPhone 17 Pro",storage:"256GB",
    color:"Cosmic Orange",modelNumber:merchant === "Jarir"?"MG674AH/A":"3P181AH/A"},
  ...overrides,
});

test("a customer compares same-model/color/capacity phones without SKU equality",()=>{
  const first=phone("Jarir");
  const second=phone("eXtra");
  const noSku=phone("Sharaf DG",{specs:{...first.specs,modelNumber:undefined}});
  const cases=[[first,second,noSku],[noSku,first,second],[second,noSku,first]];
  for(const offers of cases){
    const groups=groupComparableOffers(offers);
    assert.equal(groups.length,1);
    assert.equal(groups[0].offers.length,3);
    assert.deepEqual(new Set(groups[0].offers.map(o=>o.merchant)),
      new Set(["Jarir","eXtra","Sharaf DG"]));
    const selector=buildVariantSelectorState(groups,{skuKey:"MG674AHA"});
    assert.equal(selector.options.skus.length,0,"SKU is not a shopper comparison dimension");
    assert.equal(selector.selectedGroup.offers.length,3);
  }
  assert.equal(
    groupComparableOffers([first,second])[0].key,
    groupComparableOffers([second,first])[0].key,
    "phone group identity must be stable regardless of merchant offer order"
  );
});

test("material differences still split phones without relying on SKU",()=>{
  const a=phone("Jarir");
  const incompatible=[
    phone("eXtra",{specs:{...a.specs,deviceType:"iPhone 17 Pro Max"}}),
    phone("eXtra",{specs:{...a.specs,storage:"512GB"}}),
    phone("eXtra",{specs:{...a.specs,color:"Deep Blue"}}),
    phone("eXtra",{condition:"used"}),
    phone("eXtra",{specs:{...a.specs,regionVersion:"USA"}}),
  ];
  for(const item of incompatible.slice(0,4)){
    assert.equal(groupComparableOffers([a,item]).length,2,JSON.stringify(item.specs));
  }
  const middleEast=phone("Jarir",{specs:{...a.specs,regionVersion:"Middle East"}});
  assert.equal(groupComparableOffers([middleEast,incompatible[4]]).length,2,
    "explicit incompatible region variants must not be silently merged");
  const unknownRegion=phone("eXtra");
  assert.equal(groupComparableOffers([middleEast,unknownRegion]).length,1,
    "missing region evidence alone should not impose an SKU gate");
  const carrier=phone("eXtra",{title:"Apple iPhone 17 Pro 256GB Cosmic Orange (Verizon)"});
  assert.equal(groupComparableOffers([a,carrier]).length,2,
    "a carrier-contract phone cannot be treated as an unrestricted equivalent");
});

test("direct merchant URL comparison retains matching phones with different SKUs",()=>{
  const a=phone("Jarir");
  const b=phone("eXtra");
  const compared=mergeComparisonOffers(a,[b]);
  assert.equal(compared.length,2);
  assert.equal(compared[1].exactMatch,true,"SKU disagreement must not downgrade a known phone configuration");
  assert.equal(compared[1].specs.modelNumber,"3P181AH/A","do not mutate merchant's original SKU");
});

test("direct phone comparison rejects a different model/variant and preserves non-phone SKU rules",()=>{
  const a=phone("Jarir");
  const diff=[
    phone("eXtra",{title:"Apple iPhone 17 Pro Max 256GB Cosmic Orange",
      specs:{...a.specs,deviceType:"iPhone 17 Pro Max"}}),
    phone("eXtra",{title:"Apple iPhone 17 Pro 512GB Cosmic Orange",
      specs:{...a.specs,storage:"512GB"}}),
    phone("eXtra",{title:"Apple iPhone 17 Pro 256GB Deep Blue",
      specs:{...a.specs,color:"Deep Blue"}}),
    phone("eXtra",{condition:"used"})
  ];
  for (const x of diff) assert.equal(mergeComparisonOffers(a,[x])[1].exactMatch,false);
  const p={...a,title:"HP Laptop Pavilion 15",specs:{brand:"HP",modelNumber:"HP123",ram:"8GB"},sourceUrl:"https://example.com/hp"};
  const q={...p,merchant:"eXtra",sourceUrl:"https://example.com/hp2",specs:{...p.specs,modelNumber:"HP987"}};
  assert.equal(mergeComparisonOffers(p,[q])[1].exactMatch,false,
    "non-phone variants must retain the existing SKU conflict guard");
});
