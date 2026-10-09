import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const laptop="https://www.xcite.com/hp-laptop-intel-core-i5-1334u-8gb-ram-512gb-ssd-intel-iris-xe-graphics-windows-11-home-15-6-fhd-c70tmea-abv-silver/p";
const airpods="https://www.xcite.com/apple-airpods-4-white/p";
function catalog(name,url,price){
 return '<html><script type="application/ld+json">'+JSON.stringify({
  "@type":"Product",name,url,image:"https://cdn.media.amplience.net/i/xcite/catalog-image.jpg",
  offers:{price,priceCurrency:"KWD"},
 })+"</script></html>";
}
test("Xcite HP laptop fallback uses real-site /p product structure and KWD currency",async()=>{
 const old=globalThis.fetch,calls=[];
 try{
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes("/hp-laptops/c"))return new Response(catalog("HP Laptop Intel Core i5 8GB",laptop,169.9),{headers:{"content-type":"text/html"}});
    if(String(url).includes("frankfurter.dev"))return Response.json({rate:12.2,date:"2026-10-09"});
    return new Response("<html></html>",{headers:{"content-type":"text/html"}});
  };
  const result=await searchFreeStorefrontById("xcite-kw","hp laptop",{perStore:4});
  assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
  assert.equal(result.offers[0].sourceUrl,laptop);
  assert.equal(result.offers[0].originalCurrency,"KWD");
  assert.equal(result.offers[0].currency,"SAR");
  assert.equal(result.diagnostics.searchPage.acquisitionFallback,"xcite-official-category");
 }finally{globalThis.fetch=old;}
});
test("Xcite AirPods fallback reads price only from product data",async()=>{
 const old=globalThis.fetch;
 try{
  globalThis.fetch=async url=>{
    if(String(url).includes("/apple-airpods/c"))return new Response(catalog("Apple AirPods 4 White",airpods,34.9),{headers:{"content-type":"text/html"}});
    if(String(url).includes("frankfurter.dev"))return Response.json({rate:12.2,date:"2026-10-09"});
    return new Response("<html></html>",{headers:{"content-type":"text/html"}});
  };
  const result=await searchFreeStorefrontById("xcite-kw","airpods",{perStore:4});
  assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
  assert.equal(result.offers[0].sourceUrl,airpods);
 }finally{globalThis.fetch=old;}
});
test("Xcite unrecognized/negative query must not be substituted with category products",async()=>{
 const old=globalThis.fetch,calls=[];
 try{
  globalThis.fetch=async url=>{calls.push(String(url));return new Response("<html></html>",{headers:{"content-type":"text/html"}});};
  const result=await searchFreeStorefrontById("xcite-kw","nawaa-unfindable-943271-20261003",{perStore:4});
  assert.equal(result.offers.length,0);
  assert.equal(calls.some(url=>url.includes("/hp-laptops/c")||url.includes("/apple-airpods/c")),false);
 }finally{globalThis.fetch=old;}
});
