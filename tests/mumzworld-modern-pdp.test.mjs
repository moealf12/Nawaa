import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const strollerPdp="https://www.mumzworld.com/sa-en/neobreez-nolite-ultra-compact-stroller-black-44483883-909-nbr121bk";
const babyPdp="https://www.mumzworld.com/sa-en/kim-kimmy-newborn-baby-diapers-size-one-pack-32";
const pricedProduct=(name,url,price)=>'<html><script type="application/ld+json">'+JSON.stringify({
  "@type":"Product",name,url,image:"https://d3mljha427bkch.cloudfront.net/stroller.jpg",
  offers:{price,priceCurrency:"SAR"},
})+"</script></html>";

test("Mumzworld modern PDP slug + stroller official catalog are search-eligible",async()=>{
 const old=globalThis.fetch;const calls=[];
 try {
   globalThis.fetch=async url=>{
     calls.push(String(url));
     if(String(url).includes("/c/travel-gear/strollers-prams/stroller"))
       return new Response(pricedProduct("Neobreez Compact Stroller Black",strollerPdp,679),{headers:{"content-type":"text/html"}});
     return new Response("<html><body>search has no priced cards</body></html>",{headers:{"content-type":"text/html"}});
   };
   const result=await searchFreeStorefrontById("mumzworld-sa","stroller",{perStore:5});
   assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
   assert.equal(result.offers[0].sourceUrl,strollerPdp);
   assert.equal(result.offers[0].productPrice,679);
   assert.equal(result.offers[0].currency,"SAR");
   assert.equal(result.diagnostics.searchPage.acquisitionFallback,"mumzworld-official-category");
   assert.ok(calls.some(url=>url.includes("/c/travel-gear/strollers-prams/stroller")));
 }finally{globalThis.fetch=old;}
});

test("Mumzworld baby category maps to verified official baby-care offers",async()=>{
 const old=globalThis.fetch;
 try {
   globalThis.fetch=async url=>{
     if(String(url).includes("/c/collections/baby-care"))
       return new Response(pricedProduct("Kim Kimmy Newborn Baby Diapers",babyPdp,32),{headers:{"content-type":"text/html"}});
     return new Response("<html></html>",{headers:{"content-type":"text/html"}});
   };
   const result=await searchFreeStorefrontById("mumzworld-sa","baby",{perStore:5});
   assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
   assert.equal(result.offers[0].sourceUrl,babyPdp);
   assert.equal(result.offers[0].productPrice,32);
 }finally{globalThis.fetch=old;}
});

test("Mumzworld negative query never substitutes unrelated category data",async()=>{
 const old=globalThis.fetch;const urls=[];
 try{
   globalThis.fetch=async url=>{
     urls.push(String(url));
     return new Response("<html></html>",{headers:{"content-type":"text/html"}});
   };
   const result=await searchFreeStorefrontById("mumzworld-sa","nawaa-unfindable-943271-20261003",{perStore:5});
   assert.equal(result.offers.length,0);
   assert.equal(urls.some(url=>url.includes("/c/collections/")||url.includes("/c/travel-gear/")),false);
 }finally{globalThis.fetch=old;}
});
