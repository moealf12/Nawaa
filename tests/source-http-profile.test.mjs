import test from "node:test";
import assert from "node:assert/strict";
import {
  NAWAA_INDEXER_USER_AGENT, merchantRequestHeaders,
  productPageRequestHeaders, observedSourceHttpStatus,
} from "../src/source-http-profile.mjs";

const fallback = Object.freeze({
  accept:"text/html,application/xhtml+xml",
  "user-agent":"existing-mock/1.0",
  "sec-fetch-dest":"document",
});

test("Thomann search profile identifies NAWAA, not a browser or botnet", () => {
  const headers = merchantRequestHeaders("thomann-de",fallback);
  assert.equal(headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
  assert.match(headers["user-agent"],/moealf12\/Nawaa/);
  assert.equal(headers["accept-language"],"de-DE,de;q=0.9,en;q=0.5");
  assert.equal(headers.accept,"text/html,application/xhtml+xml;q=0.9");
  assert.ok(!Object.keys(headers).some(key => key.startsWith("sec-fetch-")));
  assert.equal(headers["cache-control"],undefined);
  assert.equal(headers["accept-encoding"],undefined);
  assert.equal(headers["x-forwarded-for"],undefined);
});

test("Non-Thomann source headers are left unchanged", () => {
  for (const id of ["amazon-de","amazon-sa","bike24-de",null,undefined]) {
    assert.deepEqual(merchantRequestHeaders(id,fallback),fallback);
  }
});

test("PDP profile applies only to the exact public Thomann HTTPS host", () => {
  const allowed = [
    "https://www.thomann.de/de/akg_k_240_studio_kopfhoerer.htm",
    "https://www.thomann.de/de/akg_k_361.htm?type=quickSearch",
  ];
  for (const url of allowed) {
    assert.equal(productPageRequestHeaders(url,fallback)["user-agent"],NAWAA_INDEXER_USER_AGENT);
  }
  for (const url of [
    "https://www.thomann.de.evil.example/de/akg.htm",
    "http://www.thomann.de/de/akg.htm",
    "https://evil@www.thomann.de/de/akg.htm",
    "https://www.amazon.de/dp/B012345678",
    "not-a-url",
  ]) assert.deepEqual(productPageRequestHeaders(url,fallback),fallback,url);
});

test("Observed HTTP statuses stay separate from cause inference", () => {
  assert.equal(observedSourceHttpStatus(new Error("HTTP 403")),403);
  assert.equal(observedSourceHttpStatus(new Error("HTTP 429")),429);
  assert.equal(observedSourceHttpStatus(new Error("Product page returned 403")),403);
  assert.equal(observedSourceHttpStatus({status:503}),503);
  assert.equal(observedSourceHttpStatus("HTTP 200"),200);
  assert.equal(observedSourceHttpStatus(new Error("socket timeout")),null);
  assert.equal(observedSourceHttpStatus(new Error("SOURCE_RATE_LIMIT_COOLDOWN")),null);
});
