import test from "node:test";
import assert from "node:assert/strict";
import {extractAliExpressSearchEvidence as extract} from "../src/aliexpress-search-evidence.mjs";

const ID="1005012743543835";
const base={
  redirectedId:ID,productId:ID,itemType:"productV3",
  title:{displayTitle:"Wireless Bluetooth Headphones"},
  image:{imgUrl:"https://ae-pic-a1.aliexpress-media.com/kf/S19.jpg"},
  prices:{salePrice:{currencyCode:"USD",minPrice:29.99}},
  productDetailUrl:"https://www.aliexpress.us/item/"+ID+".html?spm=source",
};
function html(item=base){return "<html><script>window.state="+JSON.stringify(item)+";</script></html>";}
const norm=x=>String(x||"").toLowerCase().trim();

test("live-format productV3 parses price, currency, image, and exact merchant-supplied product URL",()=>{
  const diag={};
  const result=extract(html(),"Bluetooth",diag,norm);
  assert.equal(result.length,1);
  assert.equal(result[0].productId,ID);
  assert.equal(result[0].price,29.99);
  assert.equal(result[0].currency,"USD");
  assert.equal(result[0].sourceUrl,base.productDetailUrl);
  assert.equal(result[0].priceKind,"SEARCH_CARD_MINIMUM_VARIANT_UNVERIFIED");
  assert.equal(result[0].customerPublishable,false);
  assert.equal(result[0].pdpPriceVerified,false);
  assert.equal(diag.accepted,1);
  assert.equal(diag.customerPublishable,false);
});

test("originalPrice is never a substitute for missing salePrice",()=>{
  const item={...base,prices:{originalPrice:{currencyCode:"USD",minPrice:1000}}};
  assert.equal(extract(html(item),"Bluetooth",{},norm).length,0);
});

test("price, currency and variant range are strictly validated",()=>{
  for(const amount of [0,-5,"1e3","29.991",null,"NaN","Infinity"]){
    const item={...base,prices:{salePrice:{currencyCode:"USD",minPrice:amount}}};
    assert.equal(extract(html(item),"Bluetooth",{},norm).length,0,String(amount));
  }
  for(const currency of [null,"usd","US D","USDD"]){
    const item={...base,prices:{salePrice:{currencyCode:currency,minPrice:29.99}}};
    assert.equal(extract(html(item),"Bluetooth",{},norm).length,0,String(currency));
  }
  const ranged={...base,prices:{salePrice:{currencyCode:"USD",minPrice:29.99,maxPrice:31}}};
  assert.equal(extract(html(ranged),"Bluetooth",{},norm)[0].maxVariantPrice,31);
  const reversed={...base,prices:{salePrice:{currencyCode:"USD",minPrice:29.99,maxPrice:20}}};
  assert.equal(extract(html(reversed),"Bluetooth",{},norm).length,0);
});

test("an unrelated merchant link, swap or deceptive CDN never acquires source attribution",()=>{
  const fakeUrls=[
    "https://www.aliexpress.us/item/3256812557229083.html",
    "https://www.aliexpress.us/w/wholesale-headphones.html",
    "https://www.aliexpress.com.evil.test/item/"+ID+".html",
    "https://evil.test/item/"+ID+".html",
    "http://www.aliexpress.com/item/"+ID+".html",
    "https://user:pass@www.aliexpress.com/item/"+ID+".html",
  ];
  for(const url of fakeUrls){
    const result=extract(html({...base,productDetailUrl:url}),"Bluetooth",{},norm);
    assert.equal(result.length,0,url);
  }
  for(const image of [
    "https://ae-pic-a1.aliexpress-media.com.evil.test/kf/1.jpg",
    "https://bad-aliexpress-media.com/kf/1.jpg",
    "http://ae-pic-a1.aliexpress-media.com/kf/1.jpg",
  ]){
    assert.equal(extract(html({...base,image:{imgUrl:image}}),"Bluetooth",{},norm).length,0,image);
  }
});

test("mixed malformed JSON, duplicate items, unrelated queries and 5MB cap fail closed",()=>{
  const d={};
  assert.equal(extract(html()+html(),"Bluetooth",d,norm).length,1);
  assert.equal(d.rejectedReasons.DUPLICATE_PRODUCT,1);
  assert.equal(extract(html(),"coffee",{},norm).length,0);
  assert.equal(extract('{"redirectedId":5,"itemType":}',"Bluetooth",{},norm).length,0);
  assert.equal(extract("x".repeat(5_000_001),"Bluetooth",{},norm).length,0);
});

test("top-level legacy salePrice remains recognized, without allowing unrelated originalPrice",()=>{
  const item={...base,prices:undefined,salePrice:{minPrice:11.25,currencyCode:"SAR"}};
  assert.equal(extract(html(item),"Bluetooth",{},norm)[0].price,11.25);
});
