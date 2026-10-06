import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Crawlee acquisition is bounded and production dependency is declared",()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
  const source=fs.readFileSync(new URL("../server/universal-acquisition.mjs",import.meta.url),"utf8");
  assert.equal(pkg.dependencies.crawlee,"3.18.2");
  assert.match(source,/CheerioCrawler/);
  assert.match(source,/maxRequestsPerCrawl:1/);
  assert.match(source,/maxConcurrency:1/);
  assert.match(source,/maxRequestRetries:1/);
  assert.match(source,/persistStorage:false/);
});
