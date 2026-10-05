import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("homepage search submission preserves query and uses explicit canonical navigation", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /searchForm\.addEventListener\('submit',e=>\{\s*e\.preventDefault\(\)/);
  assert.match(html, /const query=input\.value\.trim\(\)/);
  assert.match(html, /destination\.searchParams\.set\('q',query\)/);
  assert.match(html, /location\.assign\(destination\.href\)/);
  assert.doesNotMatch(html, /searchForm\.action=window\.NAWAA_SEARCH_URL/);
});
