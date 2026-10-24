import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// v21.74: production product discovery must share the selected-PDP
// destination policy instead of opening a second crawler-owned connection.
// The Crawlee dependency remains legitimate for the separate crawler worker.
test("Discovery reuses bounded pinned transport; Crawlee remains a worker dependency",()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  const source=fs.readFileSync(new URL("../server/universal-acquisition.mjs",import.meta.url),"utf8");
  assert.equal(pkg.dependencies.crawlee,"3.18.2");
  assert.equal(pkg.dependencies.cheerio,"^1.1.2");
  assert.match(source,/export function extractDiscoveredProductUrls\(/);
  assert.match(source,/Buffer\.byteLength\(html\)>MAX_BODY_BYTES/);
  assert.match(source,/fetchHtmlSafe\(url,0,\{signal:controller\.signal\}\)/);
  assert.match(source,/Math\.min\(12000/);
  assert.doesNotMatch(source,/new CheerioCrawler\s*\(/,
    "discovery must not create a separately configured network transport");
});
