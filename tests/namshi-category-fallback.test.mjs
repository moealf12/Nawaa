import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const product="https://www.namshi.com/saudi-en/buy-classic-blue-shirt/12345/p/";
const catalogHtml='<script type="application/ld+json">'+JSON.stringify({
  "@type":"Product",
  name:"Classic Blue Cotton Shirt",
  image:"https://www.namshi.com/images/blue-shirt.jpg",
  url:product,
  offers:{price:100,priceCurrency:"SAR"},
})+"</script>";

test("Namshi shirt fallback uses accessible official category after search HTTP 403",async()=>{
  const original=globalThis.fetch;
  const urls=[];
  try {
    globalThis.fetch=async url=>{
      urls.push(String(url));
      if(String(url).includes("/men-clothing-shirts/"))return new Response(catalogHtml,{headers:{"content-type":"text/html"}});
      return new Response("",{status:403});
    };
    const result=await searchFreeStorefrontById("namshi-sa","shirt",{perStore:3});
    assert.equal(result.offers.length,1,JSON.stringify(result.diagnostics));
    assert.equal(result.offers[0].title,"Classic Blue Cotton Shirt");
    assert.equal(result.offers[0].sourceUrl,product);
    assert.equal(result.offers[0].productPrice,100);
    assert.equal(result.diagnostics.searchPage.acquisitionFallback,"namshi-shirts-category");
    assert.equal(result.diagnostics.searchPage.categoryPagesAvailable,1);
    assert.ok(urls.some(url=>url.includes("/women-clothing-shirts_blouses/")));
    assert.ok(urls.some(url=>url.includes("/men-clothing-shirts/")));
  }finally{globalThis.fetch=original;}
});

test("Namshi 403 is still reported when category pages are also blocked",async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response("",{status:403});
    await assert.rejects(()=>searchFreeStorefrontById("namshi-sa","shirt",{perStore:3}),/HTTP 403/);
  }finally{globalThis.fetch=original;}
});
