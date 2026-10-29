import test from "node:test";
import assert from "node:assert/strict";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const IMAGE="https://f.nooncdn.com/p/test.jpg";
const sku1="N70312362V", sku2="Z20CCB8056BB8E89E0B67Z";
const link1="https://www.noon.com/saudi-en/huawei-matebook-d16-laptop/"+sku1+"/p/?o=offer-one&nav_ctx=private-session";
const link2="https://www.noon.com/saudi-en/asus-laptop-16gb/"+sku2+"/p/?o=offer-two";
const card=(url,title,price)=>
  '<a href="'+url+'"><h2 data-qa="plp-product-box-name">'+title+'</h2>'+
  '<div data-qa="plp-product-box-price"><strong class="amount">'+price+'</strong>'+
  '<span class="old-price">9999</span></div><img src="'+IMAGE+'"></a>';
const search=(...cards)=>'<html><h1>Laptop</h1>'+cards.join("")+'</html>';

test("Noon live HTML: two distinct Saudi product offers become price-observed results in one request",{
  concurrency:false,
},async()=>{
  const old=globalThis.fetch,requests=[];
  try{
    globalThis.fetch=async input=>{
      requests.push(String(input));
      return new Response(search(
        card(link1,"Huawei MateBook D16 Laptop 16GB 512GB","2,489"),
        card(link2,"ASUS Laptop 16GB 1TB SSD","3,299")
      ),{status:200,headers:{"content-type":"text/html"}});
    };
    const result=await searchFreeStorefrontById("noon-sa","Laptop",{
      perStore:2,noonSearchCardDiagnostics:true
    });
    assert.equal(requests.length,1);
    assert.equal(requests[0],"https://www.noon.com/saudi-en/search/?q=Laptop");
    assert.equal(result.offers.length,2);
    assert.deepEqual(result.offers.map(o=>o.productPrice),[2489,3299]);
    assert.deepEqual(result.offers.map(o=>o.specs.modelNumber),[sku1,sku2]);
    assert.equal(result.offers[0].sourceUrl,
      "https://www.noon.com/saudi-en/huawei-matebook-d16-laptop/"+sku1+"/p/?o=offer-one");
    assert.equal(result.offers[0].sourceMeta.priceEvidence,"LIVE_HTML_SEARCH_CARD_ONLY");
    assert.equal(result.offers[0].sourceMeta.buyboxVerified,false);
    assert.equal(result.offers[0].sourceMeta.deliveryVerified,false);
    assert.equal(result.offers[0].availability,"unknown");
    assert.equal(result.offers[0].canShipToSaudi,null);
    assert.equal(result.offers[0].shipping,null);
    assert.equal(result.diagnostics.noonSearchCards.parsedCards,2);
    assert.equal(result.diagnostics.noonSearchCards.uniqueOfferCandidates,2);
  }finally{globalThis.fetch=old}
});

test("Noon live HTML: a same-offer price conflict is held and never published",{
  concurrency:false,
},async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(search(
      card(link1,"Huawei MateBook D16 Laptop 16GB 512GB","2,489"),
      card(link1,"Huawei MateBook D16 Laptop 16GB 512GB","2,399")
    ),{status:200,headers:{"content-type":"text/html"}});
    const r=await searchFreeStorefrontById("noon-sa","Laptop",{perStore:3,noonSearchCardDiagnostics:true});
    assert.equal(r.offers.length,0);
    assert.equal(r.diagnostics.noonSearchCards.conflictingOffers,1);
  }finally{globalThis.fetch=old}
});

test("Noon live HTML: 200 homepage redirect is not valid search-page evidence",{
  concurrency:false,
},async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>({
      ok:true,status:200,url:"https://www.noon.com/saudi-en/",
      headers:new Headers({"content-type":"text/html"}),
      text:async()=>search(card(link1,"Huawei MateBook D16 Laptop","2489")),
    });
    const r=await searchFreeStorefrontById("noon-sa","Laptop",{perStore:3,noonSearchCardDiagnostics:true});
    assert.deepEqual(r.offers,[]);
    assert.equal(r.diagnostics.noonSearchCards.status,"SEARCH_CONTEXT_NOT_ATTESTED");
  }finally{globalThis.fetch=old}
});

test("Noon live HTML: explicit 403 stops all price extraction, without second request",{
  concurrency:false,
},async()=>{
  const old=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;return new Response("Forbidden",{status:403});};
    await assert.rejects(searchFreeStorefrontById("noon-sa","Laptop",{perStore:3}),/HTTP 403/);
    assert.equal(calls,1);
  }finally{globalThis.fetch=old}
});

test("Noon live HTML: other marketplace URLs and false iPhone variant do not gain a source price",{
  concurrency:false,
},async()=>{
  const old=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(search(
      card(link1.replace("saudi-en","uae-en"),"Huawei MateBook D16 Laptop 16GB","1"),
      card(link1.replace("N70312362V","N70312362X"),"Huawei MateBook D16 Laptop 16GB","1"),
      card(link1,"Huawei MateBook D16 Laptop 16GB 512GB","2489")
    ),{status:200,headers:{"content-type":"text/html"}});
    const r=await searchFreeStorefrontById("noon-sa","Laptop",{perStore:3});
    assert.equal(r.offers.length,1);
    assert.equal(r.offers[0].productPrice,2489);
  }finally{globalThis.fetch=old}
});
