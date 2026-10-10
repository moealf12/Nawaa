import test from "node:test";
import assert from "node:assert/strict";
import {proveCarrefourSearchCardImage,reconcileCarrefourImageEvidence} from "../server/tooling/carrefour-staged-image-evidence.mjs";
const url="https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-sage/p/2258790?offer=offer_1005819044&sellerId=19044";
const title="Apple iPhone 17 ,256 GB, Sage, 5G";
const image="https://cdn.mafrservices.com/img/2258790.webp";
const offer=Object.freeze({sourceUrl:url,title,originalCurrency:"AED",originalProductPrice:3400,image:null,providerMarket:"carrefour-ae"});
const card=(img=image,alt=title,price="3,400")=>'<section class="product"><img alt="'+alt+'" src="'+img+'"><a href="'+url+'"><span>'+title+'</span></a><div><span>AED</span><span>'+price+'</span></div></section>';
const pdp=(img=image,options={})=>'<script type="application/ld+json">'+JSON.stringify({
 "@context":"https://schema.org","@type":"Product",url,sku:"2258790",name:title,
 image:img,offers:{priceCurrency:"AED",price:3400,url},...options
})+'</script>';
test("merchant card proposes image with no additional requests or mutations",()=>{
 const r=proveCarrefourSearchCardImage(card(),offer);
 assert.equal(r.proposedImageUrl,image);
 assert.equal(r.networkRequests,0);
 assert.equal(r.verifiedByPdp,false);
 assert.equal(offer.image,null);
});
test("search-only image is candidate, not a certified production image",()=>{
 const r=reconcileCarrefourImageEvidence({offer,searchHtml:card()});
 assert.equal(r.verified,false);
 assert.equal(r.proposedImageUrl,null);
 assert.equal(r.status,"search_card_candidate_only");
});
test("independent matching merchant PDP proof yields staging-only image proposal",()=>{
 const r=reconcileCarrefourImageEvidence({offer,searchHtml:card(),pdpHtml:pdp()});
 assert.equal(r.verified,true);
 assert.equal(r.proposedImageUrl,image);
 assert.equal(r.status,"eligible_for_separate_staging_review");
 assert.equal(r.productionModified,false);
 assert.equal(offer.image,null);
});
test("valid PDP alone is eligible for staging review, not a production write",()=>{
 const r=reconcileCarrefourImageEvidence({offer,pdpHtml:pdp()});
 assert.equal(r.verified,true);
 assert.equal(r.cardStatus,"not_supplied");
});
test("two contradictory merchant images must never be arbitrarily chosen",()=>{
 const r=reconcileCarrefourImageEvidence({
  offer,searchHtml:card("https://cdn.mafrservices.com/other.jpg"),pdpHtml:pdp()
 });
 assert.equal(r.verified,false);
 assert.equal(r.proposedImageUrl,null);
 assert.equal(r.status,"conflicting_merchant_images");
});
test("wrong card price, model, storage and unapproved image CDN are refused",()=>{
 for(const html of [
  card(image,title,"3,399"),
  card(image,"Apple iPhone 17 Pro ,256 GB, Sage, 5G"),
  card(image,"Apple iPhone 17 ,512 GB, Sage, 5G"),
  card("https://cdn.mafrservices.com.evil.test/img.jpg")
 ]){
  assert.equal(proveCarrefourSearchCardImage(html,offer).proposedImageUrl,null);
 }
});
test("mixed products in one card container may not share photos",()=>{
 const fixture=card().replace("</section>",'<a href="https://www.carrefouruae.com/mafuae/en/other/p/9999999">Different product</a></section>');
 assert.equal(proveCarrefourSearchCardImage(fixture,offer).proposedImageUrl,null);
});
test("rejects missing image evidence, wrong currency, invalid offer and oversized fixture",()=>{
 assert.equal(proveCarrefourSearchCardImage(card("https://cdn.mafrservices.com/asset.svg"),offer).proposedImageUrl,null);
 assert.throws(()=>proveCarrefourSearchCardImage(card(),{...offer,image:"https://example.com/photo.jpg"}),/invalid_carrefour_card_offer/);
 assert.throws(()=>proveCarrefourSearchCardImage(card(),{...offer,originalCurrency:"SAR"}),/invalid_carrefour_card_offer/);
 assert.throws(()=>proveCarrefourSearchCardImage("x".repeat(8_000_001),offer),/invalid_carrefour_card_html/);
});
