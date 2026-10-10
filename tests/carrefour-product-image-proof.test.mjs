import test from "node:test";
import assert from "node:assert/strict";
import {proveCarrefourPdpImage} from "../server/tooling/carrefour-product-image-proof.mjs";
const url="https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-sage/p/2258790?offer=offer_1005819044&sellerId=19044";
const title="Apple iPhone 17 ,256 GB, Sage, 5G";
const product=(extra={})=>({
 "@context":"https://schema.org","@type":"Product",
 url,sku:"2258790",name:title,
 image:"https://cdn.mafrservices.com/img/p/2258790.webp",
 offers:{"@type":"Offer",price:"3400.00",priceCurrency:"AED",url},
 ...extra
});
const html=(data)=>'<html><script type="application/ld+json">'+JSON.stringify(data)+'</script></html>';
const check=(data,opts={})=>proveCarrefourPdpImage(html(data),{sourceUrl:url,title,priceAED:3400,...opts});
test("official product JSON-LD with identical PDP title and AED price verifies image",()=>{
 const r=check(product());
 assert.equal(r.verified,true);assert.equal(r.status,"product_id_title_aed_price_image_correlated");
 assert.equal(r.imageUrl,"https://cdn.mafrservices.com/img/p/2258790.webp");
 assert.equal(r.productionSourceActivated,false);
});
test("rejects wrong PDP id even if picture and price are identical",()=>{
 const p=product({url:"https://www.carrefouruae.com/mafuae/en/phones/another/p/2258791"});
 assert.equal(check(p).verified,false);
});
test("rejects nearby product title, mismatched seller offer and price variance",()=>{
 const cases=[
  product({name:"Samsung Galaxy S26 Ultra 256GB"}),
  product({offers:{price:"3399.99",priceCurrency:"AED",url}}),
  product({offers:{price:"3400",priceCurrency:"SAR",url}}),
  product({offers:{price:"3400",priceCurrency:"AED",url:"https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-sage/p/2258790?offer=offer_other"}})
 ];
 for(const p of cases)assert.equal(check(p).verified,false,JSON.stringify(p));
});
test("rejects lookalike CDN, HTTP, SVG and tracking image",()=>{
 for(const image of [
  "https://cdn.mafrservices.com.evil.test/photo.jpg",
  "http://cdn.mafrservices.com/p.png",
  "https://cdn.mafrservices.com/icon.svg",
  "javascript:alert(1)"
 ])assert.equal(check(product({image})).verified,false,image);
});
test("rejects multiple equally matching images rather than selecting one arbitrarily",()=>{
 const r=check(product({image:[
  "https://cdn.mafrservices.com/img/front.jpg",
  "https://cdn.mafrservices.com/img/side.jpg"]}));
 assert.equal(r.verified,false);assert.equal(r.status,"ambiguous_product_images");
});
test("rejects meta-only image without corroborated price and identity",()=>{
 const r=proveCarrefourPdpImage('<meta property="og:image" content="https://cdn.mafrservices.com/iphone.jpg">',{sourceUrl:url,title,priceAED:3400});
 assert.equal(r.verified,false);assert.equal(r.imageUrl,null);
});
test("accepts array @graph Product record only when exact correlation holds",()=>{
 const r=check({"@context":"https://schema.org","@graph":[
  {"@type":"BreadcrumbList",itemListElement:[]},product()]});
 assert.equal(r.verified,true);
});
test("rejects invalid inputs and oversized HTML without network use",()=>{
 assert.throws(()=>proveCarrefourPdpImage("",{sourceUrl:"https://fake.example/mafuae/en/a/p/2258790",title,priceAED:3400}),/invalid_carrefour_image_proof_identity/);
 assert.throws(()=>proveCarrefourPdpImage("x".repeat(8_000_001),{sourceUrl:url,title,priceAED:3400}),/invalid_carrefour_image_proof_document/);
});
test("validates raw AED numeric money, not converted SAR or fabricated price",()=>{
 assert.equal(check(product(),{priceAED:3469.6}).verified,false);
 assert.equal(check(product(),{priceAED:0}).verified,false);
});
