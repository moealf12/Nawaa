import test from "node:test";
import assert from "node:assert/strict";
import { parseExtraPrice, normalizeExtraUrl, extraUrlSkuHint, checkExtraProductUrl, resolveExtraProductUrl } from "../server/extra-url-health.mjs";

const root = "https://www.extra.com/en-sa/phones/iphone/p/100462492";
function response(status, location) {
  return { status, headers: { get: (key) => key === "location" ? location ?? null : null } };
}
test("strict positive prices and hostile values", () => {
  for (const v of [0, -1, "1garbage", "Infinity", true, [], {}, "1.999", null]) assert.equal(parseExtraPrice(v), null);
  assert.equal(parseExtraPrice("3299.00"), 3299);
});
test("domain and credentials, fragment", () => {
  assert.equal(normalizeExtraUrl("https://evil.com/?next=extra.com"), null);
  assert.equal(normalizeExtraUrl("http://www.extra.com/p/100462492"), null);
  assert.equal(normalizeExtraUrl("https://x:pw@www.extra.com/p/100462492"), null);
  assert.equal(normalizeExtraUrl("/p/100462492#tracking"), "https://www.extra.com/p/100462492");
});
test("SKU is a path hint not authoritative evidence", () => {
  assert.equal(extraUrlSkuHint(root, "100462492"), true);
  assert.equal(extraUrlSkuHint(root + "9", "100462492"), false);
  assert.equal(extraUrlSkuHint("https://www.extra.com/p/notit?sku=100462492", "100462492"), false);
  assert.equal(extraUrlSkuHint("https://www.extra.com/item/100462492", "100462492"), false);
});
test("HEAD 405 falls back to GET", async () => {
  const methods = [];
  const result = await checkExtraProductUrl(root, "100462492", {fetchImpl: async (_, options) => {methods.push(options.method); return response(options.method === "HEAD" ? 405 : 200);}});
  assert.equal(result.status, "OK");
  assert.deepEqual(methods, ["HEAD", "GET"]);
  assert.equal(result.identityVerified, false);
});
test("manual redirects return final URL", async () => {
  const redirected = "https://www.extra.com/en-sa/other/p/100462492";
  const result = await checkExtraProductUrl(root, "100462492", {fetchImpl: async (url) => response(url === root ? 302 : 200, "/en-sa/other/p/100462492")});
  assert.equal(result.status, "OK");
  assert.equal(result.url, redirected);
});
test("external redirect is refused before request", async () => {
  let count = 0;
  const result = await checkExtraProductUrl(root, "100462492", {fetchImpl: async () => { count++; return response(302,"https://evil.example/"); }});
  assert.equal(result.status, "UNSAFE_REDIRECT");
  assert.equal(count, 1);
});
test("redirect loop terminates", async () => {
  const result = await checkExtraProductUrl(root, "100462492", {fetchImpl: async () => response(302,root)});
  assert.equal(result.status, "REDIRECT_LOOP");
});
test("404 does not retry and fallback can be used", async () => {
  let count=0;
  const fallback="https://www.extra.com/en-sa/other/p/100462492";
  const result=await resolveExtraProductUrl({sku:"100462492",price:3299,product_url:root},fallback,{fetchImpl:async (url)=>{count++;return response(url===root?404:200);},delayMs:0});
  assert.equal(result,fallback);assert.equal(count,2);
});
test("no price and mismatching SKU fail closed", async () => {
  assert.equal(await resolveExtraProductUrl({sku:"100462492",price:0,product_url:root}),null);
  assert.equal(await resolveExtraProductUrl({sku:"100462493",price:300,product_url:root}),null);
});
test("retry 503 once", async () => {
  let n=0;
  const result=await resolveExtraProductUrl({sku:"100462492",price:3299,product_url:root},null,{fetchImpl:async()=>response(++n===1?503:200),delayMs:0});
  assert.equal(result,root);assert.equal(n,2);
});
