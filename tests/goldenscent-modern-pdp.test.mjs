import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const makeProduct=(title,url,price)=>'<html><script type="application/ld+json">'+JSON.stringify({
  "@type":"Product",name:title,url,
  image:"https://cdn.example.com/goldenscent-product.jpg",
  offers:{price,priceCurrency:"SAR"},
})+"</script></html>";

test("Golden Scent category fallback recognizes modern /en/p/ perfume PDP",async()=>{
  const original=globalThis.fetch;
  const url="https://www.goldenscent.com/en/p/roberto-cavalli-paradiso-eau-de-parfum-for-women";
  const calls=[];
  try {
    globalThis.fetch=async input=>{
      calls.push(String(input));
      const body=String(input).includes("/en/c/perfumes")
        ? makeProduct("Roberto Cavalli Paradiso Perfume for Women",url,118)
        : "<html></html>";
      return new Response(body,{headers:{"content-type":"text/html"}});
    };
    const result=await searchFreeStorefrontById("goldenscent-sa","perfume",{perStore:5});
    assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
    assert.equal(result.offers[0].sourceUrl,url);
    assert.equal(result.offers[0].productPrice,118);
    assert.equal(result.diagnostics.searchPage.acquisitionFallback,"goldenscent-official-category");
    assert.ok(calls.some(x=>x.includes("/en/c/perfumes")));
  }finally{globalThis.fetch=original;}
});

test("Golden Scent lipstick falls back only to relevant lip catalog",async()=>{
 const original=globalThis.fetch;
 const url="https://www.goldenscent.com/en/p/flormar-sheer-up-lipstick";
 try{
   globalThis.fetch=async input=>new Response(String(input).includes("/en/c/beauty/makeup/lips")
     ? makeProduct("Flormar Sheer Up Lipstick",url,29) : "<html></html>",{headers:{"content-type":"text/html"}});
   const result=await searchFreeStorefrontById("goldenscent-sa","lipstick",{perStore:5});
   assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
   assert.equal(result.offers[0].sourceUrl,url);
 }finally{globalThis.fetch=original;}
});

test("Golden Scent negative search never fetches unrelated sale categories",async()=>{
 const original=globalThis.fetch,calls=[];
 try{
  globalThis.fetch=async url=>{calls.push(String(url));return new Response("<html></html>",{headers:{"content-type":"text/html"}});};
  const result=await searchFreeStorefrontById("goldenscent-sa","nawaa-unfindable-943271-20261003",{perStore:5});
  assert.equal(result.offers.length,0);
  assert.equal(calls.some(u=>u.includes("/en/c/")),false);
 }finally{globalThis.fetch=original;}
});
