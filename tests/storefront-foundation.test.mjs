import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../index.html", import.meta.url),"utf8");
const ids = [...page.matchAll(/<[^>]+\bid="([^"]+)"/g)].map(x=>x[1]);
const idCounts = ids.reduce((map,id)=>(map.set(id,(map.get(id)||0)+1),map),new Map());
const hrefs=[...page.matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*>/g)].map(x=>x[1]);

test("storefront IDs and all local anchor destinations are unique and resolvable",()=>{
 assert.deepEqual([...idCounts].filter(([,n])=>n!==1),[]);
 assert.equal(idCounts.get("price"),1,"#price is reserved for live comparison search");
 assert.equal(idCounts.get("pricing-policy"),1,"pricing editorial section has distinct anchor");
 assert.deepEqual(hrefs.filter(h=>!idCounts.has(h)),[],"all local navigation links must lead somewhere");
});
test("editorial price navigates to policy, while search links route to comparison",()=>{
 assert.match(page,/<section class="section rose section-pad" id="pricing-policy">/);
 assert.match(page,/<section class="search-engine" id="price">/);
 assert.match(page,/href="#pricing-policy">منطق السعر/);
 assert.match(page,/href="#price">البحث والمقارنة/);
});
test("existing shortlist cards are operable by keyboard, without a fake product purchase",()=>{
 assert.equal((page.match(/<article class="card[^>]+role="button" tabindex="0"/g)||[]).length,3);
 assert.equal((page.match(/aria-haspopup="dialog"/g)||[]).length,3);
 assert.match(page,/e\.key==='Enter'\|\|e\.key===' '/);
 assert.match(page,/e\.preventDefault\(\);activate\(\)/);
});
test("drawer has accessible state, focus return, and keyboard trap",()=>{
 assert.match(page,/id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle" aria-hidden="true" inert/);
 assert.match(page,/id="menuBtn"[^>]*aria-controls="drawer" aria-expanded="false"/);
 assert.match(page,/drawerReturnFocus=document\.activeElement/);
 assert.match(page,/drawer\.removeAttribute\('inert'\)/);
 assert.match(page,/drawer\.setAttribute\('inert',''\)/);
 assert.match(page,/drawerReturnFocus\.focus\(\{preventScroll:true\}\)/);
 assert.match(page,/e\.key==='Escape'/);
 assert.match(page,/e\.key!=='Tab'/);
});
test("Hero and live search routing contracts are preserved",()=>{
 assert.match(page,/id="heroHologram" aria-pressed="true"/);
 assert.match(page,/id="sculpture" src="assets\/nawaa-hero-sculpture\.png"/);
 assert.match(page,/id="nawaaSearchForm" action="\.\/search\.html"/);
 assert.match(page,/destination\.searchParams\.set\('q',query\)/);
 const inline=page.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];
 assert.ok(inline);
 assert.doesNotThrow(()=>new Function(inline));
});
