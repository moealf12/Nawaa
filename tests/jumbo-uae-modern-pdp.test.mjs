import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById,extractProductLinks} from "../server/providers/free-storefronts.mjs";

const iphone="https://www.jumbo.ae/apple-iphone-17-smartphone-black-256-gb.html";
const airpods="https://www.jumbo.ae/apple-airpods-4-active-noise-cancelling.html";
function card(title,url,price){
 return '<html><script type="application/ld+json">'+JSON.stringify({
  "@type":"Product",name:title,url,
  image:"https://cdn.jumbo.ae/products/genuine-image.jpg",
  offers:{price,priceCurrency:"AED"},
 })+"</script></html>";
}
test("Jumbo category recovers correct priced iPhone product page",async()=>{
 const original=globalThis.fetch, urls=[];
 try{
  globalThis.fetch=async url=>{
   urls.push(String(url));
   if(String(url).includes("/apple-iphone-17"))
     return new Response(card("Apple iPhone 17 Smartphone Black 256 GB",iphone,3399),{headers:{"content-type":"text/html"}});
   if(String(url).includes("frankfurter.dev"))return Response.json({rate:1.02,date:"2026-10-09"});
   return new Response("<html></html>",{headers:{"content-type":"text/html"}});
  };
  const result=await searchFreeStorefrontById("jumbo-ae","iphone 17",{perStore:5});
  assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
  assert.equal(result.offers[0].sourceUrl,iphone);
  assert.equal(result.offers[0].originalCurrency,"AED");
  assert.equal(result.offers[0].currency,"SAR");
  assert.equal(result.diagnostics.searchPage.acquisitionFallback,"jumbo-official-product-category");
 }finally{globalThis.fetch=original;}
});
test("Jumbo AirPods fallback retains actual priced PDP rather than SEO estimates",async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
   if(String(url).includes("/apple-airpods"))return new Response(card("Apple AirPods 4 Active Noise Cancelling",airpods,749),{headers:{"content-type":"text/html"}});
   if(String(url).includes("frankfurter.dev"))return Response.json({rate:1.02,date:"2026-10-09"});
   return new Response("<html></html>",{headers:{"content-type":"text/html"}});
  };
  const result=await searchFreeStorefrontById("jumbo-ae","airpods",{perStore:5});
  assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
  assert.equal(result.offers[0].sourceUrl,airpods);
  assert.equal(result.offers[0].originalCurrency,"AED");
 }finally{globalThis.fetch=original;}
});
test("Jumbo negative query cannot substitute general category prices",async()=>{
 const original=globalThis.fetch,urls=[];
 try{
  globalThis.fetch=async url=>{urls.push(String(url));return new Response("<html></html>",{headers:{"content-type":"text/html"}});};
  const result=await searchFreeStorefrontById("jumbo-ae","nawaa-unfindable-943271-20261003",{perStore:5});
  assert.equal(result.offers.length,0);
  assert.equal(urls.some(url=>url.includes("/apple-iphone-17")||url.includes("/apple-airpods")),false);
 }finally{globalThis.fetch=original;}
});
