import test from "node:test";
import assert from "node:assert/strict";
import {assessOfferMatch,productCategory,filterQueryOffers} from "../src/search-query.mjs";

// Actual shopper-visible titles captured from production R04 ten-query audit
// https://github.com/moealf12/Nawaa/actions/runs/41160879122
// These are REPLAY assertions, not invented merchant offers or live prices.
const cases=[
  {id:"iphone-photo-stick",query:"iPhone 17 256GB",title:
    "iDiskk【App-le Certified 4in1 256GB】iPhone Photo stick work with iPhone17//16/15/14/13/12 etc. iPad/Android/Mac/Tablets/PC",
   expected:"accessory"},
  {id:"s25-german-protector",query:"Samsung Galaxy S25 Ultra",title:
    "Panzerfolie für Samsung Galaxy S25 ULTRA Schutzfolie Display Schutzglas",expected:"accessory"},
  {id:"s25-english-screen-glass",query:"Samsung Galaxy S25 Ultra",title:
    "Pokolan Pack of 3 Matte Screen Protectors for Samsung Galaxy S25 Ultra Protective Glass, Matte Glass Film",expected:"accessory"},
  {id:"s25-user-guide",query:"Samsung Galaxy S25 Ultra",title:
    "Samsung Galaxy S25 Ultra User Guide: Master Setup, Camera Features, Customization, and Troubleshooting",expected:"book"},
  {id:"s25-italian-battery-cover",query:"سامسونج جالكسي S25 الترا",title:
    "Vetro posteriore coperchio batteria con obiettivo Samsung Galaxy S25 Ultra",expected:"accessory"},
  {id:"s25-digitizer",query:"سامسونج جالكسي S25 الترا",title:
    "TFT For Samsung Galaxy S25 Ultra LCD Display Touch Screen Digitizer Assembly",expected:"accessory"},
  {id:"ps5-german-horizontal-stand",query:"PS5 Digital Edition",title:
    "PS5 Slim Digital Edition Horizontal Standfüße Halterung, PS5 Slim ohne Laufwerk",expected:"accessory"},
  {id:"hp-ram-upgrade",query:"HP laptop 16GB RAM",title:
    "2x 16GB 32GB RAM DDR4 3200Mhz PC4-3200AA für HP Victus Gaming Laptop 15-fa0xxx",expected:"accessory"},
];
const offer=(item)=>({title:item.title,merchant:"Live recorded title",condition:"new",
  sourceUrl:"https://example.org/replay/"+item.id,productPrice:999,currency:"SAR",
  specs:{},availability:"unknown"});
for(const item of cases){
  test("R04 observed RED retail item, not requested main device: "+item.id,()=>{
    const o=offer(item);
    const category=productCategory(o);
    assert.equal(category,item.expected,item.id+" category");
    const match=assessOfferMatch(item.query,o);
    assert.equal(match.exactMatch,false,item.id+" must not be a certified exact main product");
    assert.equal(filterQueryOffers(item.query,[o]).offers.length,0,
      "strict discovery path must not publish accessory as principal item");
  });
}
test("R04 legitimate bundles and complete principal items remain discoverable",()=>{
  const valid=[
    ["iPhone 17 256GB","Apple iPhone 17 256GB Black New"],
    ["Samsung Galaxy S25 Ultra","Samsung Galaxy S25 Ultra AI Phone 256GB 12GB RAM Smartphone"],
    ["PS5 Digital Edition","Sony PS5 Digital Edition Console - White"],
    ["PS5 Digital Edition","PlayStation 5 Digital Edition Console, 825GB with extra Dualsense Controller"],
    ["HP laptop 16GB RAM","HP EliteBook 840 G6 Business Laptop Intel Core i7 16GB RAM 512GB SSD"],
  ];
  for(const [query,title] of valid){
    const o={title,merchant:"Legitimate replay",sourceUrl:"https://example.org/principal",
      productPrice:3000,currency:"SAR",condition:"new",specs:{}};
    assert.notEqual(productCategory(o),"accessory",query+" "+title);
    assert.equal(assessOfferMatch(query,o).exactMatch,true,
      "must not overcorrect legitimate device: "+query+" "+title);
  }
});
