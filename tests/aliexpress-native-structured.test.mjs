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

test("real exact-ID anchor recovers a source-backed PDP when item object points to a campaign",()=>{
  const campaign={...base,productDetailUrl:"https://www.aliexpress.com/p/BundleDeals2.html"};
  assert.equal(extract(html(campaign),"Bluetooth",{},norm).length,0);
  const sourceAnchor="https://www.aliexpress.us/item/"+ID+".html";
  const withLink=html(campaign)+'<a data-id="evidence" href="'+sourceAnchor+'?campaign=1">product</a>';
  const d={};
  const recovered=extract(withLink,"Bluetooth",d,norm);
  assert.equal(recovered.length,1);
  assert.equal(new URL(recovered[0].sourceUrl).pathname,"/item/"+ID+".html");
  assert.equal(recovered[0].customerPublishable,false);
  assert.equal(d.rejectedProductLinks,0);
  for(const spoof of [
    '<a href="https://www.aliexpress.us/item/3256812557229083.html">different item</a>',
    '<a href="https://www.aliexpress.us.evil.test/item/'+ID+'.html">impostor</a>',
    '<a href="http://www.aliexpress.us/item/'+ID+'.html">unsafe</a>',
  ]) assert.equal(extract(html(campaign)+spoof,"Bluetooth",{},norm).length,0);
});

test("full itemList hydration retains products regardless of redirectedId property order",()=>{
  const otherId="1005012743543836";
  const first={
    itemType:"productV3",productId:ID,
    title:{displayTitle:"Bluetooth Headphones {new}"},
    redirectedId:ID,image:base.image,prices:base.prices,
    productDetailUrl:"https://www.aliexpress.us/item/"+ID+".html",
  };
  const second={
    itemType:"productV3",title:{displayTitle:"Bluetooth Speaker"},
    productId:otherId,prices:base.prices,
    image:base.image,redirectedId:otherId,
    productDetailUrl:"https://www.aliexpress.us/item/"+otherId+".html",
  };
  const payload={root:{fields:{mods:{itemList:{content:[first,second]}}}}};
  const live='<script>window._dida_config_._init_data_={data:'+JSON.stringify(payload)+'};</script>';
  const d={};
  const cards=extract(live,"Bluetooth",d,norm);
  assert.deepEqual(cards.map(x=>x.productId),[ID,otherId]);
  assert.equal(d.parser,"ALIEXPRESS_EMBEDDED_INIT_DATA");
  assert.equal(d.structuredCandidates,2);
  assert.equal(d.customerPublishable,false);
});

test("different embedded productId and redirectedId cannot inherit each other's offer",()=>{
  const changed={...base, redirectedId:"3256812557229083"};
  const diagnostics={};
  assert.equal(extract(html(changed),"Bluetooth",diagnostics,norm).length,0);
  assert.equal(diagnostics.rejectedReasons.EMBEDDED_PRODUCT_ID_CONFLICT,1);
  assert.equal(diagnostics.customerPublishable,false);
});

test("top-level legacy salePrice remains recognized, without allowing unrelated originalPrice",()=>{
  const item={...base,prices:undefined,salePrice:{minPrice:11.25,currencyCode:"SAR"}};
  assert.equal(extract(html(item),"Bluetooth",{},norm)[0].price,11.25);
});
