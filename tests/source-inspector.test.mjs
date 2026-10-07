import test from "node:test";
import assert from "node:assert/strict";
import { detectCapabilities } from "../server/source-inspector/discovery/capabilities.mjs";
import { probeJsonLd } from "../server/source-inspector/probes/jsonld.mjs";
import { scoreExtractionStrategy, rankStrategies } from "../server/source-inspector/scoring/extraction-score.mjs";
import { evaluateCertification, SOURCE_STATES } from "../server/source-inspector/certification/rules.mjs";
import { inspectSource } from "../server/source-inspector/inspector.mjs";

test("detects structured storefront capabilities", () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">{}</script><script type="application/ld+json">{}</script>';
  const c = detectCapabilities({ html, url:"https://shop.example/search?q=iphone" });
  assert.equal(c.platform, "nextjs");
  assert.equal(c.jsonLd, true);
  assert.equal(c.embeddedJson, true);
  assert.equal(c.searchHint, true);
});

test("extracts priced product JSON-LD", () => {
  const html = '<script type="application/ld+json">{"@type":"Product","name":"Phone","offers":{"@type":"Offer","price":"1999","priceCurrency":"SAR"}}</script>';
  const r = probeJsonLd(html);
  assert.equal(r.products, 1);
  assert.equal(r.pricedProducts, 1);
  assert.equal(r.coverage, 1);
});

test("strategy scoring ranks stronger strategy first", () => {
  const ranked = rankStrategies([
    { id:"html", metrics:{correctness:.7,completeness:.7,stability:.7,speed:.8,repeatability:.7,maintainability:.6,resourceCost:.9} },
    { id:"jsonld", metrics:{correctness:.98,completeness:.95,stability:.9,speed:.95,repeatability:.9,maintainability:.95,resourceCost:1} },
  ]);
  assert.equal(ranked[0].id, "jsonld");
  assert.ok(scoreExtractionStrategy(ranked[0].metrics).score > 90);
});

test("certification cannot pass on reachability alone", () => {
  const r = evaluateCertification({reachable:true,strategyScore:90});
  assert.equal(r.passed, false);
  assert.equal(r.state, SOURCE_STATES.CANDIDATE);
});

test("fast inspector produces capability manifest and strategy", async () => {
  const fetchImpl = async () => new Response(
    '<html><script type="application/ld+json">{"@type":"Product","name":"Laptop","offers":{"price":"3500","priceCurrency":"SAR"}}</script></html>',
    { status:200, headers:{"content-type":"text/html"} }
  );
  const result = await inspectSource("https://example.com/product/1", {fetchImpl});
  assert.equal(result.probes.html.ok, true);
  assert.equal(result.capabilities.jsonLd, true);
  assert.equal(result.selectedStrategy.id, "jsonld");
  assert.equal(result.certification.state, SOURCE_STATES.CANDIDATE);
  assert.equal(result.deepProbeRequired, false);
});
