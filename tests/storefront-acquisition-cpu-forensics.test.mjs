import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {makeFixture,inspectFixture,fixtureExtractionProfile,SYNTHETIC_SEARCH} from "../scripts/profile-storefront-acquisition-cpu.mjs";
import {extractProductLinks} from "../server/providers/free-storefronts.mjs";

test("synthetic acquisition identifies first-party product links without merchant HTTP",()=>{
  const x=inspectFixture(makeFixture(32));
  assert.equal(x.linkCount,32);
  assert.equal(new Set(x.links.map(p=>p[0])).size,32);
  assert.ok(x.links.every(p=>p[0].startsWith("https://fixture.invalid/product/")));
  assert.ok(Number.isFinite(x.linkCpuMs)&&x.linkCpuMs>=0);
  assert.ok(Number.isFinite(x.embeddedCpuMs)&&x.embeddedCpuMs>=0);
});

test("source parser results remain deterministic across identical complete fixtures",()=>{
  const html=makeFixture(60);
  const a=inspectFixture(html);
  const b=inspectFixture(html);
  assert.deepEqual(a.links,b.links);
  assert.deepEqual(a.embedded,b.embedded);
});

test("source discovery does not accept third-party offer links as first-party products",()=>{
  const store={id:"synthetic-fixture",productPath:/\/product\/\d+(?:[?#]|$)/i};
  const html='<a href="https://attacker.invalid/product/99999">iPhone 17</a>'+
    '<a href="/product/12345">iPhone 17</a>';
  const results=extractProductLinks(html,SYNTHETIC_SEARCH,store,"iphone 17");
  assert.equal(results.length,1);
  assert.equal(results[0].url,"https://fixture.invalid/product/12345");
});

test("per-phase CPU profiler uses bounded finite samples without provider traffic",()=>{
  const record=fixtureExtractionProfile({sizes:[4],rounds:2});
  assert.equal(record.environment,"synthetic_fixture_no_network");
  assert.equal(record.results.length,1);
  assert.equal(record.results[0].links,4);
  for(const key of ["linkParserMedianCpuMs","embeddedParserMedianCpuMs","totalMedianElapsedMs"])
    assert.ok(Number.isFinite(record.results[0][key])&&record.results[0][key]>=0);
});

test("source implementation currently repeats JSON-LD scanning and merits a guarded repair",()=>{
  const source=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("async function searchStore("));
  // Historical baseline can invoke once in primary and again in fallback.
  const count=(body.match(/extractJsonLdSearchOffers\(html,/g)||[]).length;
  assert.ok(count>=2,"baseline duplication must be present or this experiment needs reassessment");
});
