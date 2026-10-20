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

test("v19 RED: a promotional sidebar price must not create a second product offer when JSON-LD has the product price", () => {
 const $=cheerio.load(`
 <h1>HP OmniBook 14 Laptop</h1>
 <script type="application/ld+json">{"@type":"Product","name":"HP OmniBook 14 Laptop","offers":{"price":"2999","priceCurrency":"SAR"},"sku":"HP-14"}</script>
 <aside><span class="price">SAR 59 accessory offer</span></aside>
 `);
 const items=extractOffersFromPage({$,url:"https://shop.example/products/hp-omnibook"});
 assert.equal(items.length,1,JSON.stringify(items.map(o=>({strategy:o.extractionStrategy,price:o.productPrice}))));
 assert.equal(items[0].productPrice,2999);
 assert.equal(items[0].extractionStrategy,"jsonld");
});

test("v19 RED: metadata product price wins over unrelated visible page promotion", () => {
 const $=cheerio.load(`
 <h1>Canon Camera</h1>
 <meta property="product:price:amount" content="2499">
 <meta property="product:price:currency" content="SAR">
 <aside class="price">SAR 29 camera strap</aside>
 `);
 const items=extractOffersFromPage({$,url:"https://shop.example/products/canon"});
 assert.deepEqual(items.map(o=>o.productPrice),[2499]);
 assert.equal(items[0].extractionStrategy,"metadata");
});

test("v19 RED: conflicting bare DOM prices without product evidence remain unpriced", () => {
 const $=cheerio.load(`
 <h1>HP Laptop 14</h1>
 <main><div class="price">SAR 2999</div></main>
 <aside><span class="price">SAR 49 promotional accessory</span></aside>
 `);
 assert.deepEqual(extractOffersFromPage({$,url:"https://shop.example/products/laptop"}),[]);
});

test("v19: one unambiguous visible product price remains available as fallback", () => {
 const $=cheerio.load(`<h1>HP Laptop 14</h1><main><span class="price">SAR 2999</span></main>`);
 const items=extractOffersFromPage({$,url:"https://shop.example/products/hp"});
 assert.equal(items.length,1);
 assert.equal(items[0].productPrice,2999);
 assert.equal(items[0].currency,"SAR");
 assert.equal(items[0].extractionStrategy,"visible-dom");
});
