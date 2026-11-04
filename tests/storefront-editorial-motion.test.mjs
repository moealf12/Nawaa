import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const editorial=html.slice(html.indexOf('<section class="section dark section-pad" id="selection">'),html.indexOf('<section class="section rose section-pad" id="pricing-policy">'));

test("keep the three original photo-led editorial cards, order, and asymmetric grid",()=>{
 assert.match(html,/\.cards\{display:grid;grid-template-columns:1\.17fr \.83fr;grid-template-rows:410px 310px;gap:18px\}/);
 assert.equal((editorial.match(/<article class="card/g)||[]).length,3);
 assert.deepEqual([...editorial.matchAll(/<article class="card[\s\S]*?<img[^>]+src="([^"]+)"/g)].map(x=>x[1]),[
  "assets/nawaa-work-study.jpg","assets/nawaa-hero-sculpture.png","assets/nawaa-home.jpg"]);
 assert.match(editorial,/أدوات تستحق مساحة على مكتبك/);
 assert.match(editorial,/منتج واحد\. حجة شراء واضحة/);
 assert.match(editorial,/تفاصيل أصغر\. أثر يومي أكبر/);
});
test("motion embellishments are decorative and restricted to original cards",()=>{
 assert.equal((editorial.match(/class="card-light" aria-hidden="true"/g)||[]).length,3);
 assert.match(html,/\.cards \.card-light\{position:absolute;inset:0;z-index:1;pointer-events:none/);
 assert.match(html,/\.cards \.card-copy\{z-index:2\}/);
 assert.match(html,/\.cards \.card:focus-visible\{outline:/);
 assert.match(html,/\.cards \.card\.abstract:hover \.mini-sculpture/);
});
test("pointer lighting is bounded, RAF-scheduled, and disabled for coarse or reduced-motion",()=>{
 assert.match(html,/editorialFinePointer=matchMedia\('\(hover:hover\) and \(pointer:fine\)'\)/);
 assert.match(html,/editorialReducedMotion=matchMedia\('\(prefers-reduced-motion:reduce\)'\)/);
 assert.match(html,/Math\.max\(0,Math\.min\(1,/);
 assert.match(html,/frame=requestAnimationFrame/);
 assert.match(html,/cancelAnimationFrame\(frame\)/);
 assert.match(html,/@media\(hover:none\)/);
 assert.match(html,/\.cards \.card-light\{opacity:0!important\}/);
});
test("category details remain keyboard accessible and modal behavior is unchanged",()=>{
 assert.equal((editorial.match(/role="button" tabindex="0" aria-haspopup="dialog"/g)||[]).length,3);
 assert.match(html,/e\.key==='Enter'\|\|e\.key===' '/);
 assert.match(html,/drawerReturnFocus\.focus\(\{preventScroll:true\}\)/);
});
test("approved hologram, comparison routing, page structure, and inline syntax stay intact",()=>{
 assert.match(html,/id="heroHologram" aria-pressed="true"/);
 assert.match(html,/id="nawaaSearchForm"/);
 assert.match(html,/destination\.searchParams\.set\('q',query\)/);
 assert.equal((html.match(/id="price"/g)||[]).length,1);
 assert.equal((html.match(/id="pricing-policy"/g)||[]).length,1);
 const code=html.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];assert.ok(code);
 assert.doesNotThrow(()=>new Function(code));
});
