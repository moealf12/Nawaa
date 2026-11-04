import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const ids=[...html.matchAll(/<[^>]+\bid="([^"]+)"/g)].map(x=>x[1]);
const links=[...html.matchAll(/<a\b[^>]*href="#([^"]+)"/g)].map(x=>x[1]);

test("discovery lives immediately after Hero/marquee and precedes editorial",()=>{
 const hero=html.indexOf('<section class="hero">');
 const discovery=html.indexOf('class="store-discovery section" id="discover"');
 const about=html.indexOf('class="section paper section-pad" id="about"');
 assert.ok(hero>=0&&discovery>hero&&about>discovery);
 assert.match(html,/id="discover" aria-labelledby="discoverTitle"/);
 assert.match(html,/id="discoverTitle"/);
});
test("three discovery paths point to existing, distinct destinations",()=>{
 const hrefs=[...html.matchAll(/<a class="discover-card[^"]*" href="#([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(hrefs,["selection-work","selection-home","price"]);
 for(const href of hrefs)assert.equal(ids.filter(id=>id===href).length,1);
 assert.equal(ids.filter(id=>id==="discover").length,1);
 assert.deepEqual(links.filter(id=>!ids.includes(id)),[]);
});
test("store pre-launch and external comparison offers remain clearly separate",()=>{
 assert.match(html,/ضمن مراجعة المتجر|مراجعة المتجر/);
 assert.match(html,/محرك مقارنة/);
 assert.match(html,/ليست منتجات متاحة للشراء حاليًا/);
 assert.match(html,/ولا تعني أن نواة هي البائع/);
 assert.doesNotMatch(html,/<section class="store-discovery[\s\S]*?<section class="section paper section-pad" id="about">[\s\S]*?data-fake-price=/);
});
test("discovery is accessible, responsive, motion-aware, and dependency-free",()=>{
 assert.equal((html.match(/<a class="discover-card/g)||[]).length,3);
 assert.match(html,/\.discover-card:focus-visible/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(html,/@media\(max-width:650px\)/);
 assert.doesNotMatch(html,/href="https:\/\/(?:fonts|cdn)/);
});
test("approved hologram and customer search route remain intact",()=>{
 assert.match(html,/id="heroHologram" aria-pressed="true"/);
 assert.match(html,/src="assets\/nawaa-hero-sculpture\.png"/);
 assert.match(html,/id="nawaaSearchForm"/);
 assert.match(html,/destination\.searchParams\.set\('q',query\)/);
 assert.equal(ids.filter(x=>x==="price").length,1);
 const code=html.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];
 assert.ok(code);assert.doesNotThrow(()=>new Function(code));
});
