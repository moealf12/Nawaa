import test from "node:test";
import assert from "node:assert/strict";
import {productCategory, assessOfferMatch, filterQueryOffers} from "../src/search-query.mjs";
import {provisionalLabel} from "../scripts/verify-r04-live-ranking.mjs";

// Captured LIVE Q04 Arabic S25 Ultra top-ten, GitHub read-only run 41313349013.
// Both were graded 3 (complete smartphone) by the old independent judge.
const incidents=[
  ["spanish_replacement_speaker","Altavoz de repuesto para Samsung Galaxy S25 Ultra Timbre Zumbador Altavoz - Reino Unido"],
  ["french_lcd_frame","Véritable Samsung Galaxy S25 Ultra S938B LCD + cadre noir de jais assemblé GH82-36387D"],
];
const query="سامسونج جالكسي S25 الترا";
const mk=title=>({title,merchant:"Recorded R04 live retail title",sourceUrl:"https://example.invalid/r04-component-replay",productPrice:1200,currency:"SAR",availability:"unknown",condition:"new",specs:{}});

for(const [name,title] of incidents){
  test(`R04 RED actual Q04 ${name} must not match the complete Galaxy phone`,()=>{
    const offer=mk(title);
    assert.equal(productCategory(offer),"accessory");
    assert.equal(assessOfferMatch(query,offer).exactMatch,false);
    assert.equal(filterQueryOffers(query,[offer]).offers.length,0);
  });
  test(`R04 RED independent Q04 ${name} grade must be zero regardless of system rank`,()=>{
    const a=provisionalLabel("galaxy",{title,exactMatch:true,matchConfidence:1,productPrice:1});
    const b=provisionalLabel("galaxy",{title,exactMatch:false,matchConfidence:0,productPrice:100000});
    assert.deepEqual(a,{grade:0,reason:"recorded_galaxy_replacement_component"});
    assert.deepEqual(a,b);
  });
}
test("R04 negative overblock guards: genuine complete Galaxy devices with included spare parts",()=>{
  const legitimate=[
    "Samsung Galaxy S25 Ultra 256GB Smartphone with included replacement speaker",
    "Samsung Galaxy S25 Ultra 256GB Smartphone with included LCD + cadre assemblé",
    "Samsung Galaxy S25 Ultra 256GB Smartphone con altavoz de repuesto incluido",
    "Samsung Galaxy S25 Ultra 256GB Smartphone avec LCD + cadre noir de rechange assemblé",
  ];
  for(const title of legitimate){
    const offer=mk(title);
    assert.notEqual(productCategory(offer),"accessory",title);
    assert.equal(assessOfferMatch("Samsung Galaxy S25 Ultra",offer).exactMatch,true,title);
    assert.equal(provisionalLabel("galaxy",{title}).grade,3,title);
  }
});
