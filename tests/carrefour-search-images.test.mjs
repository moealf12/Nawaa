import assert from "node:assert/strict";
import test from "node:test";
import {extractCarrefourSearchOffers,searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const a="https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-pro-256gb-silver/p/2258798";
const b="https://www.carrefouruae.com/mafuae/en/smartphones/apple-iphone-17-256gb-black/p/2258790";
const fixture=[
  '<div><img alt="Apple iPhone 17 Pro 256GB Silver" src="https://cdn.example.com/iphone-pro.jpg">',
  '<a href="'+a+'"><span>Apple iPhone 17 Pro 256GB Silver</span></a><div><span>AED</span><span>4,199</span></div></div>',
  '<div><img alt="Other phone model" src="https://cdn.example.com/unrelated.jpg">',
  '<a href="'+b+'"><span>Apple iPhone 17 256GB Black</span></a><div><span>AED</span><span>3,200</span></div></div>',
].join("");

test("Carrefour UAE search card attaches picture from matching title only",()=>{
 const rows=extractCarrefourSearchOffers(fixture,"iphone 17");
 assert.equal(rows.length,2);
 assert.equal(rows[0].image,"https://cdn.example.com/iphone-pro.jpg");
 assert.equal(rows[0].price,4199);
 assert.equal(rows[0].currency,"AED");
 assert.equal(rows[1].image,null,"unrelated adjacent card image must never be reused");
});
test("Carrefour AE customer search accepts a priced offer with a verified image",async()=>{
 const orig=globalThis.fetch;
 try {
   globalThis.fetch=async url=>{
     if(String(url).startsWith("https://www.carrefouruae.com"))return new Response(fixture,{headers:{"content-type":"text/html"}});
     if(String(url).includes("frankfurter.dev"))return Response.json({rate:1.02,date:"2026-10-09"});
     throw Error("Unexpected request "+url);
   };
   const result=await searchFreeStorefrontById("carrefour-ae","iphone 17",{perStore:5});
   const offer=result.offers.find(o=>o.sourceUrl===a);
   assert.ok(offer,JSON.stringify(result.diagnostics));
   assert.equal(offer.image,"https://cdn.example.com/iphone-pro.jpg");
   assert.equal(offer.originalCurrency,"AED");
   assert.equal(offer.currency,"SAR");
   assert.ok(offer.productPrice>4000);
 } finally {globalThis.fetch=orig;}
});
