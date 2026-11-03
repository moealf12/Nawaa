import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/i)?.[1];

test("hero keeps actual original sculpture and adds non-blocking hologram mask", () => {
  assert.match(html, /id="sculpture" src="assets\/nawaa-hero-sculpture\.png"/);
  assert.match(html, /-webkit-mask-image:url\("assets\/nawaa-hero-sculpture\.png"\)/);
  assert.match(html, /class="hero-sheen" aria-hidden="true"/);
  assert.match(html, /object-fit:contain/);
});
test("hero controls are localized, accessible and separately pausable", () => {
  assert.match(html, /id="heroOriginal" aria-pressed="false"/);
  assert.match(html, /id="heroHologram" aria-pressed="true"/);
  assert.match(html, /id="heroPause" aria-label="إيقاف حركة المجسم"/);
  assert.match(html, /heroReduced\.addEventListener\?\.\('change',syncHeroMode\)/);
  assert.match(html, /data-motion="on"/);
  assert.match(html, /touch-action:pan-y/);
  assert.match(html, /prefers-reduced-motion:reduce/);
});
test("scroll and pointer layers cannot overwrite each other", () => {
  assert.doesNotMatch(html, /sculpture\.style\.transform\s*=/);
  assert.match(html, /heroVisual\.style\.setProperty\('--hero-scroll-y'/);
  assert.match(html, /heroVisual\.style\.setProperty\('--tilt-x'/);
  assert.match(html, /cancelAnimationFrame\(heroPointerFrame\)/);
});
test("existing customer search and page affordances are unchanged", () => {
  assert.match(html, /id="nawaaSearchForm"/);
  assert.match(html, /destination\.searchParams\.set\('q',query\)/);
  assert.match(html, /window\.NAWAA_SEARCH_URL\|\|'\.\/search\.html'/);
  assert.match(html, /id="drawer"/);
  assert.match(html, /<section class="section paper section-pad" id="about">/);
});
test("inline script remains syntactically valid", () => {
  assert.ok(script, "page must have a script");
  assert.doesNotThrow(() => new Function(script));
});
