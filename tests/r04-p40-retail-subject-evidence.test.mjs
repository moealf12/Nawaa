import test from "node:test";
import assert from "node:assert/strict";
import {assessOfferMatch,productCategory,normalizeSearchQuery,parseSearchIntent}
  from "../src/search-query.mjs";

// Titles below were independently observed in live merchant data; these are
// local regression guards, not proof of current availability or LIVE release.
const examples=[
  ["Apple Watch Series 11","Apple Watch Series 11 GPS + Cellular, 46mm Silver Aluminum Case with Purple Fog Sport Band - M/L",true,"watch"],
  ["Apple Watch Series 11","Nomad Tempo Wrist Strap, for Apple Watch Series 11 42/Watch Series 10 42/Watch Series 9 41/Watch SE 40, FKM Fluoroelastomer Rubber, Dusk",false,"accessory"],
  ["Apple Watch Series 11","Belkin Full Body Protection Smartwatch Fit Case, for Apple Watch Series 11 46/Watch Series 10 46, Clear",false,"accessory"],
  ["ساعة ابل سيريس 11","Apple Watch Series 11 GPS + Cellular, 46mm Silver Aluminum Case with Purple Fog Sport Band - M/L",true,"watch"],
  ["عطر ديور رجالي","Dior Homme Eau de Toilette Spray, 50 ml - Pack of 1",true,"perfume"],
  ["عطر ديور رجالي","Sauvage Elixir by Christian Dior for Men 7.5ml/0.25oz Parfum | Men",true,"perfume"],
  ["عطر ديور رجالي","Miss Dior Eau de Parfum Mini Splash for Women, 0.17 Ounce",false,"perfume"],
  ["سماعة لاسلكية","HONOR Choice Earbuds X8i Wireless Headphones, 12 mm Half Open Driver",true,"audio"],
  ["حذاء نايك رياضي","Nike Air Max Running Shoes Black Size 42",true,"shoes"],
  ["حذاء نايك رياضي","Nike Air Max Shoes White",false,"shoes"],
];
for(const [q,title,exact,category] of examples){
  test("R04 P40 retail subject truth: "+q+" | "+title.slice(0,42),()=>{
    const offer={title};
    const assessed=assessOfferMatch(q,offer);
    assert.equal(productCategory(offer),category);
    assert.equal(assessed.exactMatch,exact,JSON.stringify(assessed));
  });
}
test("Arabic-brand and wireless aliases preserve shopper terms",()=>{
  assert.equal(normalizeSearchQuery("عطر ديور رجالي"),"perfume dior men");
  assert.equal(normalizeSearchQuery("سماعة لاسلكية"),"headphones wireless");
  assert.equal(parseSearchIntent("حذاء نايك رياضي").providerQuery,"nike shoes");
  assert.equal(parseSearchIntent("حذاء نايك رياضي").normalizedQuery,"shoes nike sports");
});
