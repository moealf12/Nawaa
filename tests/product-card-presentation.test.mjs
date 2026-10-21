import test from "node:test";
import assert from "node:assert/strict";
import {arabicCount, visibleProductSpecifications} from "../src/product-card-presentation.mjs";

test("Arabic cardinal morphology is count- and noun-aware", () => {
  const expected = [
    [0, "0 عروض", "0 متاجر", "0 دول"],
    [1, "عرض واحد", "متجر واحد", "دولة واحدة"],
    [2, "عرضان", "متجران", "دولتان"],
    [3, "3 عروض", "3 متاجر", "3 دول"],
    [10, "10 عروض", "10 متاجر", "10 دول"],
    [11, "11 عرضًا", "11 متجرًا", "11 دولةً"],
    [21, "21 عرضًا", "21 متجرًا", "21 دولةً"],
    [100, "100 عرض", "100 متجر", "100 دولة"],
    [103, "103 عروض", "103 متاجر", "103 دول"],
  ];
  for (const [n, offer, merchant, country] of expected) {
    assert.equal(arabicCount(n, "offer"), offer, String(n));
    assert.equal(arabicCount(n, "merchant"), merchant, String(n));
    assert.equal(arabicCount(n, "country"), country, String(n));
  }
  for (const bad of [-1, 1.5, NaN, Infinity, "2"]) {
    assert.throws(() => arabicCount(bad, "offer"), RangeError);
  }
  assert.throws(() => arabicCount(1, "nonexistent"), RangeError);
});

test("product card never turns merchant placeholder 'No' into RAM or capacity", () => {
  const entries = visibleProductSpecifications({specs:{
    color:" Silver ", storage:"No", ram:"NO", processor:"NULL",
    screenSize:"N/A", operatingSystem:"undefined", network:false,
    sim:"No", battery:0, waterproof:"No",
  }});
  assert.deepEqual(entries, [
    ["اللون","Silver"],
    ["البطارية","0"],
    ["مقاومة الماء","لا"],
  ]);
});

test("valid negative water-resistance evidence is preserved, not globally deleted", () => {
  assert.deepEqual(visibleProductSpecifications({specs:{waterproof:false}}),[["مقاومة الماء","لا"]]);
  assert.deepEqual(visibleProductSpecifications({specs:{waterproof:true}}),[["مقاومة الماء","نعم"]]);
  assert.deepEqual(visibleProductSpecifications({specs:{ram:"8 GB",storage:"512GB",color:"Black"}}),[
    ["اللون","Black"],["السعة","512GB"],["الذاكرة","8 GB"]
  ]);
  assert.deepEqual(visibleProductSpecifications({specs:{ram:"unknown",processor:{text:"i5"}}}),[]);
});

test("spec presentation is capped to ten entries without mutating evidence", () => {
  const specs={color:"red",storage:"1TB",ram:"16GB",processor:"i5",screenSize:"14 inch",screenType:"IPS",network:"5G",sim:"eSIM",operatingSystem:"Windows",rearCamera:"12MP",frontCamera:"8MP",battery:"5000mAh",waterproof:"Yes"};
  const snapshot=structuredClone(specs);
  const values=visibleProductSpecifications({specs});
  assert.equal(values.length,10);
  assert.deepEqual(specs,snapshot);
});
