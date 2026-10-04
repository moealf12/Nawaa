import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import { extractOffersFromPage } from "../workers/crawler/src/extractors.mjs";

test("advanced extractor prefers structured product JSON-LD",()=>{
 const $=cheerio.load(`<script type="application/ld+json">{"@type":"Product","name":"HP OmniBook","brand":{"name":"HP"},"sku":"ABC","image":"https://img.example/a.jpg","offers":{"price":"2999","priceCurrency":"SAR","availability":"https://schema.org/InStock"}}</script>`);
 const [o]=extractOffersFromPage({$,url:"https://shop.example/products/hp"});
 assert.equal(o.title,"HP OmniBook");assert.equal(o.productPrice,2999);assert.equal(o.currency,"SAR");assert.equal(o.sku,"ABC");
});

test("advanced extractor falls back to product metadata",()=>{
 const $=cheerio.load(`<meta property="og:title" content="HP Monitor"><meta property="product:price:amount" content="799"><meta property="product:price:currency" content="SAR"><meta property="og:image" content="https://img.example/m.jpg">`);
 const [o]=extractOffersFromPage({$,url:"https://shop.example/p/hp-monitor"});
 assert.equal(o.title,"HP Monitor");assert.equal(o.productPrice,799);assert.equal(o.extractionStrategy,"metadata");
});
