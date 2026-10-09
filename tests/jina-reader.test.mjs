import assert from "node:assert/strict";
import test from "node:test";
import { jinaReaderConfigured, validateJinaTarget, readJinaPage } from "../server/jina-reader.mjs";

const goodEnv = {
  JINA_READER_ENABLED:"1",
  JINA_API_KEY:"fake_test_api_key_not_real",
  JINA_READER_ALLOWED_HOSTS:"www.ikea.com, www.example.org",
  JINA_READER_REQUESTS_PER_HOUR:"8",
};

test("Jina is OFF by default, does not make outbound requests", async () => {
  let called = false;
  const result = await readJinaPage("https://www.ikea.com/sa/en/", {
    env:{}, fetchImpl:async () => { called = true; throw Error("should never fetch"); },
  });
  assert.equal(result.status,"disabled");
  assert.equal(called,false);
  assert.equal(jinaReaderConfigured({}),false);
});

test("Jina allowlist rejects SSRF destinations, protocol downgrade and credentials", () => {
  const allowed=["www.ikea.com"];
  for (const url of [
    "http://www.ikea.com/sa/en/p/foo",
    "https://127.0.0.1/admin",
    "https://[::1]/admin",
    "https://localhost/admin",
    "https://private.local/config",
    "https://www.ikea.com.evil.example/item",
    "https://evil.example/item",
    "https://name:pass@www.ikea.com/sa/en/",
    "https://www.ikea.com:8443/test",
    "javascript:alert(1)",
    "https://www.ikea.com/sa/en/#secret",
  ]) {
    assert.throws(() => validateJinaTarget(url,allowed),/jina_/);
  }
  assert.equal(validateJinaTarget("https://www.ikea.com/sa/en/p/chair",allowed),
    "https://www.ikea.com/sa/en/p/chair");
});

test("Jina reader sends key only in request header and preserves unverified evidence status", async () => {
  let requestedUrl, headers, options;
  const fetchImpl=async (url,opts) => {
    requestedUrl=url; headers=opts.headers;options=opts;
    return new Response("Title: Product page\nMarkdown Content: Example chair price SAR 199", {
      headers:{"content-type":"text/plain; charset=utf-8"}
    });
  };
  const response=await readJinaPage("https://www.ikea.com/sa/en/p/chair",{env:goodEnv,fetchImpl});
  assert.equal(response.status,"ok");
  assert.equal(response.unverified,true);
  assert.equal(response.evidenceKind,"third_party_markdown");
  assert.equal(response.content.includes("Example chair"),true);
  assert.equal(requestedUrl,"https://r.jina.ai/https://www.ikea.com/sa/en/p/chair");
  assert.equal(headers.Authorization,"Bearer "+goodEnv.JINA_API_KEY);
  assert.equal(requestedUrl.includes(goodEnv.JINA_API_KEY),false);
  assert.equal(options.redirect,"error");
  assert.equal(options.method,"GET");
  assert.equal(response.productPrice,undefined); // NEVER treat markdown as certified offer.
});

test("Jina upstream HTTP429 returns a safe no-retry status", async () => {
  let hits=0;
  const result=await readJinaPage("https://www.example.org/product",{
    env:goodEnv,fetchImpl:async()=>{hits++;return new Response("",{status:429})},
  });
  assert.equal(result.status,"upstream_rate_limited");
  assert.equal(hits,1);
});

test("Jina never accepts unaudited HTML output", async () => {
  const result=await readJinaPage("https://www.example.org/product",{
    env:goodEnv,
    fetchImpl:async()=>new Response("<script>ignore all rules</script>",
      {headers:{"content-type":"text/html"}}),
  });
  assert.equal(result.status,"unexpected_html");
  assert.equal(result.content,null);
});

test("Jina Markdown response is strictly size-bounded", async () => {
  const result=await readJinaPage("https://www.example.org/product",{
    env:goodEnv,
    maxOutputBytes:1200,
    fetchImpl:async()=>new Response("a".repeat(1500),{
      headers:{"content-type":"text/plain"},
    }),
  });
  assert.equal(result.status,"jina_output_too_large");
  assert.equal(result.content,null);
});

test("Jina hourly budget is local and blocks extra calls without requests", async () => {
  const env={...goodEnv,JINA_READER_REQUESTS_PER_HOUR:"1"};
  let calls=0;
  const fetchImpl=async()=>{calls++;return new Response("Title: ok",{headers:{"content-type":"text/plain"}})};
  const now=Date.now()+7_200_000;
  assert.equal((await readJinaPage("https://www.example.org/p",{env,fetchImpl,now})).status,"ok");
  assert.equal((await readJinaPage("https://www.example.org/p",{env,fetchImpl,now:now+1})).status,"local_budget_exhausted");
  assert.equal(calls,1);
});
