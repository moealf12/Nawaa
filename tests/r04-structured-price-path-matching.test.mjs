import test from "node:test";
import assert from "node:assert/strict";
import {extractEmbeddedSearchOffers,extractProductLinks} from "../server/providers/free-storefronts.mjs";

// Real source registry shape: PcComponentes has a pathname-anchored product
// pattern. Previously these already-priced, same-merchant cards were rejected
// because ^/ cannot match an absolute https:// URL.
const store={id:"pccomponentes-es",productPath:
  /^\/(?!buscar(?:\/|$)|search(?:\/|$)|category(?:\/|$)|configurador(?:\/|$))[a-z0-9-]{18,}(?:[?#]|$)/i};
const searchUrl="https://www.pccomponentes.com/buscar/?query=iphone%2017";
const productPath="/apple-iphone-17-256gb-libre-negro";
const productUrl="https://www.pccomponentes.com"+productPath;
const card=(overrides={})=>({
  id:"retailer-owned-sku-112",name:"Apple iPhone 17 256GB Libre Negro",
  price:799.00,currency:"EUR",url:productPath,...overrides,
});
const embedded=(cards)=>'<script type="application/json">'+
  JSON.stringify({catalog:{items:cards}})+'</script>';

test("R04: pathname-anchored merchant URL retains a retailer-owned structured price",()=>{
  const offers=extractEmbeddedSearchOffers(embedded([card()]),searchUrl,store,"iphone 17 256gb");
  assert.equal(offers.length,1);
  assert.equal(offers[0].title,"Apple iPhone 17 256GB Libre Negro");
  assert.equal(offers[0].productPrice,undefined,"raw source price is not falsely converted to SAR");
  assert.equal(offers[0].price,799);
  assert.equal(offers[0].currency,"EUR");
  assert.equal(offers[0].sourceUrl,productUrl);
  assert.equal(offers[0].productId,"retailer-owned-sku-112");
});

test("R04: same path attestation recovers safe product anchors, not catalogs",()=>{
  const html='<a href="'+productPath+'">Apple iPhone 17 256GB Libre Negro</a>'+
    '<a href="/buscar/?query=iphone+17">Search results</a>';
  const links=extractProductLinks(html,searchUrl,store,"iphone 17",10);
  assert.deepEqual(links.map(x=>x.url),[productUrl]);
});

test("R04: reject off-domain offers, unpriced cards and non-PDP paths",()=>{
  const bad=[
    card({url:"https://attacker.invalid"+productPath}),
    card({url:"/buscar/iphone-17-256gb"}),
    card({price:null}),
    card({currency:""}),
  ];
  assert.deepEqual(extractEmbeddedSearchOffers(embedded(bad),searchUrl,store,"iphone 17 256gb"),[]);
  const links=extractProductLinks(
    '<a href="https://attacker.invalid'+productPath+'">iPhone 17 256GB</a>'+
    '<a href="/buscar/iphone-17-256gb">iPhone 17 256GB</a>',
    searchUrl,store,"iphone 17",10);
  assert.deepEqual(links,[]);
});
