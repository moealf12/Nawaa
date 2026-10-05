import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production server exposes every browser module required by search page", async () => {
  const server = await readFile(new URL("../server/server.mjs", import.meta.url), "utf8");
  const searchPage = await readFile(new URL("../src/search-page.mjs", import.meta.url), "utf8");
  const imports = [...searchPage.matchAll(/from\s+["\'](\.\/[^"\']+)["\']/g)]
    .map((match) => "/src/" + match[1].replace(/^\.\//, ""));

  assert.ok(imports.includes("/src/search-stream.mjs"), "search page must exercise the stream helper");
  for (const browserPath of imports) {
    assert.ok(server.includes('["' + browserPath + '",'), "Render static server must expose " + browserPath);
  }
});
