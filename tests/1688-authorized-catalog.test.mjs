import test from "node:test";
import assert from "node:assert/strict";
import { is1688Configured, fetchAuthorized1688Catalog } from "../server/authorized-1688-catalog.mjs";
import { currentSources, configuredProviders } from "../server/source-config.mjs";

const env = {
  NAWAA_1688_ENABLED: "1",
  NAWAA_1688_CATALOG_URL: "https://approved-catalog.example.org/v1/1688",
  NAWAA_1688_ALLOWED_HOSTS: "approved-catalog.example.org",
  NAWAA_1688_CATALOG_TOKEN: "TEST_TOKEN_NOT_REAL",
};

test("1688: staging disabled by default and not an active free storefront", () => {
  const source = currentSources().find(x => x.id === "1688-cn");
  assert.ok(source);
  assert.equal(source.saudiDelivery, "forwarder_or_unknown");
  assert.equal(source.sourceKind, "wholesale_marketplace");
  assert.equal(source.status, "disabled");
  assert.ok(!configuredProviders().includes("1688-cn"));
});

test("1688: opt-in requires flag, public HTTPS feed, exact allowed host and token", () => {
  assert.equal(is1688Configured(env), true);
  assert.equal(is1688Configured({...env, NAWAA_1688_ENABLED: "0"}), false);
  assert.equal(is1688Configured({...env, NAWAA_1688_CATALOG_TOKEN: ""}), false);
  assert.equal(is1688Configured({...env, NAWAA_1688_ALLOWED_HOSTS: "other.example.org"}), false);
  for (const url of [
    "http://approved-catalog.example.org/v1/1688",
    "https://localhost/catalog",
    "https://127.0.0.1/data",
    "https://169.254.169.254/latest/meta-data",
    "https://approved-catalog.example.org.evil.example/data",
    "https://user:pass@approved-catalog.example.org/data",
  ]) assert.equal(is1688Configured({...env, NAWAA_1688_CATALOG_URL: url}), false, url);
});

test("1688: bounded single POST to a pinned approved catalog origin, without redirects", async () => {
  let calls = 0;
  const payload = {products: [{offerId: "123456789012"}]};
  const result = await fetchAuthorized1688Catalog("手机壳", {
    env, limit: 3,
    fetchImpl: async (url, request) => {
      calls++;
      assert.equal(url, env.NAWAA_1688_CATALOG_URL);
      assert.equal(request.method, "POST");
      assert.equal(request.redirect, "error");
      assert.equal(request.headers.authorization, "Bearer TEST_TOKEN_NOT_REAL");
      assert.deepEqual(JSON.parse(request.body), {query: "手机壳", limit: 3});
      assert.ok(request.signal);
      return new Response(JSON.stringify(payload), {
        status: 200, headers: {"content-type": "application/json"},
      });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, payload);
});

test("1688: size, MIME, and auth errors stop publication", async () => {
  await assert.rejects(fetchAuthorized1688Catalog("phone", {
    env, fetchImpl: async () => new Response("denied", {status: 401}),
  }), /1688_FEED_HTTP_401/);
  await assert.rejects(fetchAuthorized1688Catalog("phone", {
    env, fetchImpl: async () => new Response("<html>login</html>", {
      headers: {"content-type": "text/html"},
    }),
  }), /1688_FEED_NOT_JSON/);
  await assert.rejects(fetchAuthorized1688Catalog("phone", {
    env, fetchImpl: async () => new Response("x".repeat(1_048_577), {
      headers: {"content-type": "application/json"},
    }),
  }), /1688_FEED_TOO_LARGE/);
});
