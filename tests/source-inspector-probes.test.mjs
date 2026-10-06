import test from "node:test";import assert from "node:assert/strict";
import {probeEmbeddedState} from "../server/source-inspector/probes/embedded-state.mjs";
import {discoverSitemapCandidates} from "../server/source-inspector/probes/sitemap.mjs";
import {probeJsonCandidates} from "../server/source-inspector/probes/json.mjs";
import {probeFeedHints} from "../server/source-inspector/probes/feed.mjs";
test("embedded state parses Next data",()=>{const r=probeEmbeddedState('<script id="__NEXT_DATA__" type="application/json">{"props":{"id":1}}</script>');assert.equal(r.ok,true);assert.equal(r.count,1)});
test("sitemap discovery always includes conventional sitemap",()=>{const r=discoverSitemapCandidates("https://shop.example/a");assert.equal(r[0],"https://shop.example/sitemap.xml")});
test("JSON/XHR discovery classifies search endpoints",()=>{const r=probeJsonCandidates('fetch("/api/search?q=x")',"https://shop.example");assert.equal(r.ok,true);assert.equal(r.candidates[0].type,"search")});
test("feed hints discover declared XML feeds",()=>{const r=probeFeedHints("https://shop.example",'<link rel="alternate" type="application/rss+xml" href="/feed.xml">');assert.equal(r.ok,true)});

test("discovers storefront search form endpoints",()=>{const html='<form action="/en-sa/search/?text=iphone"><input name="text"></form>';const r=probeJsonCandidates(html,"https://www.extra.com/en-sa");assert.equal(r.ok,true);assert.equal(r.candidates[0].type,"search");assert.match(r.candidates[0].url,/extra\.com/);});
