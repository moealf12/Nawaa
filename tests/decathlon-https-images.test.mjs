import test from "node:test";
import assert from "node:assert/strict";
import {secureStorefrontImage,searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

test("Decathlon official CDN HTTP image becomes HTTPS for safe NAWAA page rendering",()=>{
  const input="http://decathlon.com.sa/cdn/shop/files/pic_2ca1d50e.jpg?v=1791509825&width=1024";
  const output=secureStorefrontImage(input,"decathlon-sa");
  assert.equal(output,"https://decathlon.com.sa/cdn/shop/files/pic_2ca1d50e.jpg?v=1791509825&width=1024");
});
test("No other merchant or external CDN URLs are rewritten",()=>{
  assert.equal(secureStorefrontImage("http://decathlon.com.sa/cdn/a.jpg","amazon-sa"),"http://decathlon.com.sa/cdn/a.jpg");
  assert.equal(secureStorefrontImage("http://untrusted.invalid/a.jpg","decathlon-sa"),"http://untrusted.invalid/a.jpg");
  assert.equal(secureStorefrontImage("http://evil@decathlon.com.sa/a.jpg","decathlon-sa"),"http://evil@decathlon.com.sa/a.jpg");
  assert.equal(secureStorefrontImage("https://decathlon.com.sa/a.jpg","decathlon-sa"),"https://decathlon.com.sa/a.jpg");
});
test("Decathlon offer preserves its own product ID, SAR amount and safe image URL",async()=>{
 const old=globalThis.fetch;
 const pdp="https://decathlon.com.sa/products/men-s-jogflow-100-1-running-shoes";
 const image="http://decathlon.com.sa/cdn/shop/files/pic_2ca1d50e.jpg";
 const html='<html><script type="application/ld+json">'+JSON.stringify({
   "@type":"Product",name:"Men Jogflow 100.1 Running Shoes",url:pdp,image,
   offers:{price:185,priceCurrency:"SAR"},
 })+"</script></html>";
 try{
   globalThis.fetch=async()=>new Response(html,{headers:{"content-type":"text/html"}});
   const data=await searchFreeStorefrontById("decathlon-sa","shoes",{perStore:5});
   assert.equal(data.offers.length,1,JSON.stringify(data.diagnostics));
   assert.equal(data.offers[0].image,"https://decathlon.com.sa/cdn/shop/files/pic_2ca1d50e.jpg");
   assert.equal(data.offers[0].sourceUrl,pdp);
   assert.equal(data.offers[0].productPrice,185);
 }finally{globalThis.fetch=old;}
});
