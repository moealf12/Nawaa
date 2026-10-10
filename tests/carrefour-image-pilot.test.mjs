import test from "node:test";
import assert from "node:assert/strict";
import {inspectOneCarrefourImageFromPdp} from "../server/tooling/carrefour-image-pilot.mjs";
const url="https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-sage/p/2258790?offer=offer_1005819044&sid=DEFAULT&sellerId=19044";
const offer=Object.freeze({
 providerMarket:"carrefour-ae",sourceUrl:url,
 title:"Apple iPhone 17 ,256 GB, Sage, 5G",
 originalProductPrice:3400,originalCurrency:"AED",image:null});
const env={NAWAA_CI_EPHEMERAL_SOURCE_PROBE:"1",
 NAWAA_ENABLE_EXPLICIT_CARREFOUR_IMAGE_PILOT:"1",
 NAWAA_ENABLE_BACKGROUND_JOBS:"0",
 NAWAA_ENABLE_CERTIFIED_INGESTION:"0",DATABASE_URL:""};
const product={
 "@type":"Product",url,sku:"2258790",name:offer.title,
 image:"https://cdn.mafrservices.com/p/2258790.webp",
 offers:{"@type":"Offer",url,priceCurrency:"AED",price:3400}
};
const fixture=(p=product)=>"<html><body>"+JSON.stringify(p)+
 '<script type="application/ld+json">'+JSON.stringify(p)+"</script>"+
 "x".repeat(6000)+"</body></html>";
test("single explicitly enabled SKU performs exactly one non-redirected PDP lookup",async()=>{
 const calls=[];
 const r=await inspectOneCarrefourImageFromPdp({offer,env,
  fetchPage:async(...args)=>{calls.push(args);return {finalUrl:url,html:fixture()}}});
 assert.equal(r.verified,true);assert.equal(r.requestsAttempted,1);
 assert.equal(r.proposedImageUrl,"https://cdn.mafrservices.com/p/2258790.webp");
 assert.deepEqual(calls,[[url,0,{maxRedirects:0}]]);
 assert.equal(offer.image,null);
});
test("a short merchant shell response is refused rather than interpreted as an empty catalog",async()=>{
 const r=await inspectOneCarrefourImageFromPdp({offer,env,
  fetchPage:async()=>({finalUrl:url,html:"request not available"})});
 assert.equal(r.verified,false);
 assert.equal(r.status,"merchant_incomplete_product_html");
 assert.equal(r.proposedImageUrl,undefined);
});
test("a changed merchant PDP URL cannot authorize a different image",async()=>{
 const r=await inspectOneCarrefourImageFromPdp({offer,env,
  fetchPage:async()=>({finalUrl:url+"-elsewhere",html:fixture()})});
 assert.equal(r.verified,false);assert.equal(r.status,"merchant_unexpected_page_redirect");
});
test("mismatched PDP price stays unverified with no offer mutations",async()=>{
 const r=await inspectOneCarrefourImageFromPdp({offer,env,
  fetchPage:async()=>({finalUrl:url,html:fixture({
   ...product,offers:{...product.offers,price:3401}})})});
 assert.equal(r.verified,false);assert.equal(r.proposedImageUrl,null);
 assert.equal(offer.image,null);
});
test("non-ephemeral or disabled environments cannot make any request",async()=>{
 let calls=0;
 for(const e of [
  {...env,NAWAA_CI_EPHEMERAL_SOURCE_PROBE:"0"},
  {...env,NAWAA_ENABLE_EXPLICIT_CARREFOUR_IMAGE_PILOT:"0"},
  {...env,DATABASE_URL:"postgres://prod"},
  {...env,NAWAA_ENABLE_BACKGROUND_JOBS:"1"}
 ]){
  await assert.rejects(inspectOneCarrefourImageFromPdp({
   offer,env:e,fetchPage:async()=>{calls++}}),/explicit_carrefour_image_pilot_disabled/);
 }
 assert.equal(calls,0);
});
test("unapproved product and existing image cannot be reprocessed",async()=>{
 let calls=0;
 for(const o of [{...offer,sourceUrl:url.replace("2258790","2258791")},
  {...offer,image:"https://example.com/other.jpg"},
  {...offer,providerMarket:"carrefour-sa"},
  {...offer,originalCurrency:"SAR"}]){
  await assert.rejects(inspectOneCarrefourImageFromPdp({offer:o,env,
   fetchPage:async()=>{calls++}}),/unapproved_carrefour_pilot_offer/);
 }
 assert.equal(calls,0);
});

test("optional already-captured search HTML adds corroboration without an extra GET",async()=>{
 const search='<section class="card">'+
  '<img alt="Apple iPhone 17 ,256 GB, Sage, 5G" src="https://cdn.mafrservices.com/p/2258790.webp">'+
  '<a href="'+url+'"><span>'+offer.title+'</span></a>'+
  '<div><span>AED</span><span>3,400</span></div></section>';
 let calls=0;
 const r=await inspectOneCarrefourImageFromPdp({
  offer,env,searchHtml:search,
  fetchPage:async()=>{calls++;return {finalUrl:url,html:fixture()}}
 });
 assert.equal(calls,1);
 assert.equal(r.requestsAttempted,1);
 assert.equal(r.verified,true);
 assert.equal(r.status,"eligible_for_separate_staging_review");
 assert.equal(r.proposedImageUrl,"https://cdn.mafrservices.com/p/2258790.webp");
 assert.equal(offer.image,null);
});
test("contradictory captured search photo vetoes an otherwise valid PDP",async()=>{
 const search='<section class="card">'+
  '<img alt="Apple iPhone 17 ,256 GB, Sage, 5G" src="https://cdn.mafrservices.com/other-product.webp">'+
  '<a href="'+url+'"><span>'+offer.title+'</span></a>'+
  '<div><span>AED</span><span>3,400</span></div></section>';
 const r=await inspectOneCarrefourImageFromPdp({
  offer,env,searchHtml:search,fetchPage:async()=>({finalUrl:url,html:fixture()})
 });
 assert.equal(r.verified,false);
 assert.equal(r.status,"conflicting_merchant_images");
 assert.equal(r.proposedImageUrl,null);
 assert.equal(offer.image,null);
});
test("fabricated environment flags cannot activate real network transport",async()=>{
 await assert.rejects(
  inspectOneCarrefourImageFromPdp({offer,env}),
  /real_carrefour_pilot_requires_process_flags/
 );
});
