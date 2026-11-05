import test from "node:test";
import assert from "node:assert/strict";
import {
  NAWAA_INDEXER_USER_AGENT,
  merchantRequestHeaders,
  productPageRequestHeaders
} from "../src/source-http-profile.mjs";

const incoming = {
  "user-agent":"Mozilla/5.0 fake-browser",
  "sec-fetch-site":"none",
  "sec-fetch-mode":"navigate",
  "accept-language":"en-US",
};

test("R04 AliExpress search headers transparently identify NAWAA, not a human browser",()=>{
  const headers=merchantRequestHeaders("aliexpress-cn",incoming);
  assert.equal(headers["user-agent"],NAWAA_INDEXER_USER_AGENT);
  assert.match(headers["accept-language"],/^ar-SA/);
  assert.equal(headers["sec-fetch-site"],undefined);
  assert.equal(headers["sec-fetch-mode"],undefined);
  assert.notEqual(headers,incoming);
  assert.equal(incoming["user-agent"],"Mozilla/5.0 fake-browser");
});

test("R04 AliExpress Arabic, international and US PDP reads use identical honest profile",()=>{
  const ids=[
    "https://ar.aliexpress.com/item/1005009881103371.html?gatewayAdapt=glo2ara",
    "https://www.aliexpress.com/item/1005009881103371.html",
    "https://www.aliexpress.us/item/1005009881103371.html",
    "https://m.aliexpress.com/item/1005009881103371.html",
  ];
  const expected=merchantRequestHeaders("aliexpress-cn",incoming);
  for(const url of ids)assert.deepEqual(productPageRequestHeaders(url,incoming),expected);
});

test("R04 unrelated sites, impostor hosts and malformed/non-HTTPS URLs are unchanged",()=>{
  const unrelated=[
    "https://www.samsung.com/sa_en/search/",
    "https://aliexpress.com.evil.example/item/1005009881103371.html",
    "https://attacker.example/item/1005009881103371.html",
    "http://www.aliexpress.com/item/1005009881103371.html",
    "https://www.aliexpress.com:8443/item/1005009881103371.html",
    "https://user:password@www.aliexpress.com/item/1005009881103371.html",
    "not a URL"
  ];
  for(const url of unrelated)assert.deepEqual(productPageRequestHeaders(url,incoming),incoming);
  assert.deepEqual(merchantRequestHeaders("samsung-sa",incoming),incoming);
});

test("R04 existing Thomann transparent headers are preserved",()=>{
  assert.deepEqual(
    productPageRequestHeaders("https://www.thomann.de/de/superlux_hd662.htm",incoming),
    merchantRequestHeaders("thomann-de",incoming),
  );
  assert.equal(merchantRequestHeaders("thomann-de",incoming)["user-agent"],NAWAA_INDEXER_USER_AGENT);
});
