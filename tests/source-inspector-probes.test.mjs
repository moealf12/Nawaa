import test from "node:test";import assert from "node:assert/strict";
import {probeEmbeddedState} from "../server/source-inspector/probes/embedded-state.mjs";
import {discoverSitemapCandidates} from "../server/source-inspector/probes/sitemap.mjs";
import {probeJsonCandidates} from "../server/source-inspector/probes/json.mjs";
import {probeFeedHints} from "../server/source-inspector/probes/feed.mjs";
import {probeJsonLd} from "../server/source-inspector/probes/jsonld.mjs";
test("embedded state parses Next data",()=>{const r=probeEmbeddedState('<script id="__NEXT_DATA__" type="application/json">{"props":{"id":1}}</script>');assert.equal(r.ok,true);assert.equal(r.count,1)});
test("sitemap discovery always includes conventional sitemap",()=>{const r=discoverSitemapCandidates("https://shop.example/a");assert.equal(r[0],"https://shop.example/sitemap.xml")});
test("JSON/XHR discovery classifies search endpoints",()=>{const r=probeJsonCandidates('fetch("/api/search?q=x")',"https://shop.example");assert.equal(r.ok,true);assert.equal(r.candidates[0].type,"search")});
test("feed hints discover declared XML feeds",()=>{const r=probeFeedHints("https://shop.example",'<link rel="alternate" type="application/rss+xml" href="/feed.xml">');assert.equal(r.ok,true)});

test("discovers storefront search form endpoints",()=>{const html='<form action="/en-sa/search/?text=iphone"><input name="text"></form>';const r=probeJsonCandidates(html,"https://www.extra.com/en-sa");assert.equal(r.ok,true);assert.equal(r.candidates[0].type,"search");assert.match(r.candidates[0].url,/extra\.com/);});

test("JSON-LD exposes canonical product sample fields",()=>{const html='<script type="application/ld+json">'+JSON.stringify({"@type":"Product",name:"iPhone 17",sku:"EX17",brand:{name:"Apple"},url:"https://www.extra.com/p/17",image:"https://img/17.jpg",offers:{"@type":"Offer",price:"3499",priceCurrency:"SAR",availability:"https://schema.org/InStock"}})+'</script>';const r=probeJsonLd(html);assert.equal(r.sample[0].title,"iPhone 17");assert.equal(r.sample[0].price,3499);assert.equal(r.sample[0].currency,"SAR");assert.equal(r.sample[0].sku,"EX17");});
