import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAmazonDeProductUrl, fastCheckAmazonUrl, processProductsBulk,
} from "../server/amazon-de-bulk-url-health.mjs";
import { amazonDeCustomerPriceDecision } from "../src/amazon-de-price-gate.mjs";

const asin = "B0FQFW3423";
const pdp = "https://www.amazon.de/dp/" + asin;
const fake = (status, location) => ({
  status,
  headers: { get: name => name === "location" ? location ?? null : null },
  body: { cancel: async () => {} },
});

test("German Amazon host, protocol, ASIN and product-path boundaries are exact", () => {
  assert.equal(normalizeAmazonDeProductUrl(pdp + "#frag", asin), pdp);
  assert.equal(normalizeAmazonDeProductUrl("https://amazon.de/gp/aw/d/" + asin, asin),
    "https://amazon.de/gp/aw/d/" + asin);
  for (const url of [
    "https://amazon.de.evil.example/dp/" + asin,
    "https://evilamazon.de/dp/" + asin,
    "http://www.amazon.de/dp/" + asin,
    "https://name:pass@amazon.de/dp/" + asin,
    "https://www.amazon.de:8443/dp/" + asin,
    "https://www.amazon.de/s?k=" + asin,
    "https://www.amazon.de/dp/B0ABC12345",
    "https://www.amazon.de/dp/" + asin + "9",
    "https://www.amazon.de/dp/%2f" + asin,
    "https://www.amazon.de\@other.example/dp/" + asin,
  ]) assert.equal(normalizeAmazonDeProductUrl(url, asin), null, url);
  assert.equal(normalizeAmazonDeProductUrl(pdp, "bad"), null);
});

test("200 verifies only link health, never identity, buybox, price or shopper publication", async () => {
  let seen;
  const outcome = await fastCheckAmazonUrl(pdp, asin, {
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return fake(200);
    },
  });
  assert.equal(seen.url, pdp);
  assert.equal(seen.options.redirect, "manual");
  assert.equal(seen.options.method, "GET");
  assert.equal(outcome.status, "LINK_REACHABLE_NOT_ATTESTED");
  assert.equal(outcome.url, pdp);
  assert.equal(outcome.identityVerified, false);
  assert.equal(outcome.priceVerified, false);
  assert.equal(outcome.buyboxVerified, false);
  assert.equal(outcome.customerPublishable, false);
  assert.equal(amazonDeCustomerPriceDecision({sourceId:"amazon-de",sourceUrl:outcome.url}).customerPublishable, false);
});

test("301/302 cannot independently pass: safe redirects revalidate ASIN, unsafe redirects reject", async () => {
  const final = "https://amazon.de/gp/product/" + asin;
  let n = 0;
  const good = await fastCheckAmazonUrl(pdp, asin, {
    fetchImpl: async () => ++n === 1 ? fake(302, final) : fake(200),
  });
  assert.equal(good.url, final);
  assert.equal(n, 2);
  for (const bad of [
    "https://amazon.de.evil.example/dp/" + asin,
    "https://amazon.de/dp/B0ABC12345",
    "http://www.amazon.de/dp/" + asin,
    "https://www.amazon.de/s?k=watch",
  ]) {
    let calls = 0;
    const outcome = await fastCheckAmazonUrl(pdp, asin, {
      fetchImpl: async () => { calls++; return fake(301, bad); },
    });
    assert.equal(outcome.status, "UNSAFE_OR_MISMATCHED_REDIRECT", bad);
    assert.equal(calls, 1);
  }
  assert.equal((await fastCheckAmazonUrl(pdp, asin, {
    fetchImpl: async () => fake(302, pdp),
  })).status, "REDIRECT_LOOP");
});

test("HTTP 200 block pages remain unverified, denied and missing links cannot be published", async () => {
  for (const [code,status] of [[403,"ACCESS_RESTRICTED"],[429,"ACCESS_RESTRICTED"],
    [404,"NOT_FOUND"],[410,"NOT_FOUND"],[503,"HTTP_UNVERIFIED"]]) {
    const item = await fastCheckAmazonUrl(pdp, asin,{fetchImpl:async()=>fake(code)});
    assert.equal(item.status,status);
    assert.equal(item.url,null);
    assert.equal(item.customerPublishable,false);
  }
});

test("bulk diagnostics count each input, including duplicate ASINs and missing links", async () => {
  const items = [{asin,product_url:pdp},{asin,url:pdp},{asin,url:"https://evilamazon.de/dp/"+asin},
    {asin:"BAD",url:pdp},{}];
  let calls=0;
  const batch = await processProductsBulk(items, 3, {
    fetchImpl: async () => {calls++; return calls===1?fake(200):fake(404);},
  });
  assert.equal(batch.mode,"READ_ONLY_URL_HEALTH_DIAGNOSTIC");
  assert.equal(batch.sourceId,"amazon-de");
  assert.equal(batch.results.length,5);
  assert.equal(batch.success,1);
  assert.equal(batch.failed,4);
  assert.equal(calls,2);
  assert.equal(batch.results[0].asin,asin);
  assert.equal(batch.results[1].asin,asin);
  assert.equal(batch.results[2].status,"INVALID_PRODUCT_URL");
  assert.equal(batch.results[3].asin,null);
  assert.equal(batch.results[4].status,"INVALID_PRODUCT_URL");
  assert.equal(batch.results.every(item=>!item.customerPublishable && !item.priceVerified),true);
});

test("bulk network concurrency is bounded, even when caller requests 100 sockets", async () => {
  let active=0,maxActive=0;
  const fetchImpl=async()=>{
    active++;
    maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,5));
    active--;
    return fake(200);
  };
  const batch=await processProductsBulk(
    Array.from({length:20},()=>({asin,product_url:pdp})),100,{fetchImpl});
  assert.equal(batch.success,20);
  assert.equal(batch.failed,0);
  assert.ok(maxActive<=6);
  assert.ok(maxActive>1);
  await assert.rejects(
    processProductsBulk(Array.from({length:101},()=>({asin,url:pdp}))),
    /exceeds 100/);
  assert.equal((await processProductsBulk([])).results.length,0);
});

test("cancelled requests fail closed, without a network call", async () => {
  const controller=new AbortController();
  controller.abort();
  let calls=0;
  const outcome=await fastCheckAmazonUrl(pdp,asin,{
    signal:controller.signal,fetchImpl:async()=>{calls++;return fake(200);},
  });
  assert.equal(outcome.status,"ABORTED");
  assert.equal(calls,0);
});
