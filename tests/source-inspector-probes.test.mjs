import test from "node:test";import assert from "node:assert/strict";
import {probeEmbeddedState} from "../server/source-inspector/probes/embedded-state.mjs";
import {discoverSitemapCandidates} from "../server/source-inspector/probes/sitemap.mjs";
import {probeJsonCandidates} from "../server/source-inspector/probes/json.mjs";
import {probeFeedHints} from "../server/source-inspector/probes/feed.mjs";
import {probeJsonLd} from "../server/source-inspector/probes/jsonld.mjs";
import {discoverPagination} from "../server/source-inspector/discovery/pagination.mjs";
test("embedded state parses Next data",()=>{const r=probeEmbeddedState('<script id="__NEXT_DATA__" type="application/json">{"props":{"id":1}}</script>');assert.equal(r.ok,true);assert.equal(r.count,1)});
test("sitemap discovery always includes conventional sitemap",()=>{const r=discoverSitemapCandidates("https://shop.example/a");assert.equal(r[0],"https://shop.example/sitemap.xml")});
test("JSON/XHR discovery classifies search endpoints",()=>{const r=probeJsonCandidates('fetch("/api/search?q=x")',"https://shop.example");assert.equal(r.ok,true);assert.equal(r.candidates[0].type,"search")});
test("feed hints discover declared XML feeds",()=>{const r=probeFeedHints("https://shop.example",'<link rel="alternate" type="application/rss+xml" href="/feed.xml">');assert.equal(r.ok,true)});

test("discovers storefront search form endpoints",()=>{const html='<form action="/en-sa/search/?text=iphone"><input name="text"></form>';const r=probeJsonCandidates(html,"https://www.extra.com/en-sa");assert.equal(r.ok,true);assert.equal(r.candidates[0].type,"search");assert.match(r.candidates[0].url,/extra\.com/);});

test("JSON-LD exposes canonical product sample fields",()=>{const html='<script type="application/ld+json">'+JSON.stringify({"@type":"Product",name:"iPhone 17",sku:"EX17",brand:{name:"Apple"},url:"https://www.extra.com/p/17",image:"https://img/17.jpg",offers:{"@type":"Offer",price:"3499",priceCurrency:"SAR",availability:"https://schema.org/InStock"}})+'</script>';const r=probeJsonLd(html);assert.equal(r.sample[0].title,"iPhone 17");assert.equal(r.sample[0].price,3499);assert.equal(r.sample[0].currency,"SAR");assert.equal(r.sample[0].sku,"EX17");});

test("discovers page pagination without executing it",()=>{const r=discoverPagination('<a href="/en-sa/phones?page=2" rel="next">Next</a>',"https://www.extra.com/en-sa/phones");assert.equal(r.ok,true);assert.equal(r.model,"next-link");assert.match(r.candidates[0].url,/page=2/);});

test("v20.1 RED inspector must not certify AggregateOffer.lowPrice as an exact price",()=>{
 const product={"@type":"Product",name:"HP OmniBook 14",sku:"OMNIBOOK",offers:{"@type":"AggregateOffer",lowPrice:999,highPrice:4999,offerCount:12,priceCurrency:"SAR"}};
 const html='<script type="application/ld+json">'+JSON.stringify(product)+'</script>';
 const r=probeJsonLd(html);
 assert.equal(r.products,1);
 assert.equal(r.pricedProducts,0,"aggregate range is not an actual variant or seller's purchasable price");
 assert.equal(r.sample[0].price,null);
 assert.equal(r.sample[0].currency,null,"do not claim a priced offer currency from a range");
});

test("v20.1 RED inspector must not select the first of multiple incompatible priced variants",()=>{
 const product={"@type":"Product",name:"iPhone 17",offers:[
  {"@type":"Offer",sku:"IPH17-256",price:3199,priceCurrency:"SAR"},
  {"@type":"Offer",sku:"IPH17-512",price:4199,priceCurrency:"SAR"}
 ]};
 const html='<script type="application/ld+json">'+JSON.stringify(product)+'</script>';
 const r=probeJsonLd(html);
 assert.equal(r.products,1);
 assert.equal(r.pricedProducts,0,"variant array has no single authoritative exact price");
 assert.equal(r.sample[0].price,null);
});

test("v20.1 inspector keeps unambiguous specific product Offer eligible",()=>{
 const product={"@type":"Product",name:"iPhone 17 512GB",sku:"IPH17-512",offers:{"@type":"Offer",price:4199,priceCurrency:"SAR"}};
 const r=probeJsonLd('<script type="application/ld+json">'+JSON.stringify(product)+'</script>');
 assert.equal(r.pricedProducts,1);
 assert.equal(r.sample[0].price,4199);
 assert.equal(r.sample[0].currency,"SAR");
});
