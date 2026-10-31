import test from "node:test";
import assert from "node:assert/strict";
import {productCategory,assessOfferMatch,filterQueryOffers} from "../src/search-query.mjs";

// Literal first-screen product title recorded in successful GitHub Actions
// production query Q04 (Arabic), run 41245264321. Replay, NOT live inventory.
const sourceTitle="Samsung Galaxy Official S25 Ultra S Pen for Galaxy S25 Ultra Grey SM-S938N";
const offer=title=>({title,merchant:"Recorded source title",sourceUrl:"https://example.invalid/r04-spen-replay",
  productPrice:500,currency:"SAR",condition:"new",availability:"unknown",specs:{}});
test("R04 RED: actual Arabic S25 Ultra rank-2 standalone S Pen must not match the phone",()=>{
  const item=offer(sourceTitle),query="سامسونج جالكسي S25 الترا";
  assert.equal(productCategory(item),"accessory",sourceTitle);
  assert.equal(assessOfferMatch(query,item).exactMatch,false);
  assert.deepEqual(filterQueryOffers(query,[item]).offers,[]);
});
test("R04: standalone S Pen stylus is not a handset in English or Arabic searches",()=>{
  for(const query of ["Samsung Galaxy S25 Ultra","سامسونج جالكسي S25 الترا"]){
    for(const title of ["S Pen for Samsung Galaxy S25 Ultra", "Original Samsung Galaxy S25 Ultra S Pen Replacement Stylus"]){
      const item=offer(title);
      assert.equal(productCategory(item),"accessory",title);
      assert.equal(assessOfferMatch(query,item).exactMatch,false,title);
      assert.equal(filterQueryOffers(query,[item]).offers.length,0,title);
    }
  }
});
test("R04: genuine Galaxy S25 Ultra handset with included S Pen stays a phone",()=>{
  for(const title of [
    "Samsung Galaxy S25 Ultra 256GB Smartphone with included S Pen",
    "Samsung Galaxy S25 Ultra 256GB 12GB RAM Smartphone",
    "Samsung Galaxy S25 Ultra 256GB Smartphone S Pen Included",
  ]){
    const item=offer(title);
    assert.equal(productCategory(item),"phone",title);
    assert.equal(assessOfferMatch("Samsung Galaxy S25 Ultra",item).exactMatch,true,title);
    assert.equal(filterQueryOffers("Samsung Galaxy S25 Ultra",[item]).offers.length,1,title);
  }
});

const observedWrongPrincipalResults=[
  {id:"q03-rear-camera-lens",query:"Samsung Galaxy S25 Ultra",type:"accessory",
    title:"Perzework 2 Sets Back Rear Camera Lens Glass Replacement for Samsung Galaxy S25 Ultra 6.9-inches with pre-Installed Adhesi"},
  {id:"q03-german-user-guide",query:"Samsung Galaxy S25 Ultra",type:"book",
    title:"Samsung Galaxy S25 Ultra Benutzerhandbuch: Meistern Sie Ihr Gerät mit Schritt-für-Schritt-Anleitungen"},
  {id:"q04-italian-charge-port",query:"سامسونج جالكسي S25 الترا",type:"accessory",
    title:"Originale Samsung Galaxy S25 ULTRA S938B presa di ricarica connettore dock USB microfono"},
  {id:"q04-lcd-frame-assembly",query:"سامسونج جالكسي S25 الترا",type:"accessory",
    title:"Genuine Samsung Galaxy S25 Ultra S938B Lcd+frame Jet Black Assembled GH82-36387D"},
  {id:"q11-jbl-replacement-earpads",query:"JBL Bluetooth headphones",type:"accessory",
    title:"Ear Pads Replacement Cushion for JBL E35 E45bt E45 Bluetooth Wireless Headphones"},
  {id:"q15-italian-memory-module",query:"HP laptop 16GB RAM",type:"accessory",
    title:"16GB Memoria RAM HP-Compaq Pavilion Notebook 15-da3000nia"},
  {id:"q15-so-dimm-memory",query:"HP laptop 16GB RAM",type:"accessory",
    title:"16GB RAM SO DIMM DDR5 5600Mhz PC5-5600B for HP Notebook Omen Laptop 16-b1xxx"},
];
for(const c of observedWrongPrincipalResults){
  test("R04 production first-ten recorded principal-item mismatch "+c.id,()=>{
    const item=offer(c.title);
    assert.equal(productCategory(item),c.type,c.title);
    assert.equal(assessOfferMatch(c.query,item).exactMatch,false,c.title);
    assert.equal(filterQueryOffers(c.query,[item]).offers.length,0,
      "standalone component/book cannot enter a principal-device exact search");
  });
}
test("R04 main retail subject with included camera lens, earpads or charging cable is still a full device",()=>{
  const full=[
    ["Samsung Galaxy S25 Ultra 256GB Smartphone with included camera lens protector","phone"],
    ["JBL Tune 520BT Bluetooth Headphones with replacement ear pads included","audio"],
    ["HP EliteBook 840 G6 16GB RAM Laptop Intel Core i7 with included protective sleeve","laptop"],
  ];
  for(const [title,type] of full)
    assert.equal(productCategory(offer(title)),type,title);
});
