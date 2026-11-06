import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGoogleShoppingDiscoveryQuery,
  buildGoogleShoppingDiscoveryUrl,
  googleShoppingDiscoveryDescriptor,
} from "../src/google-shopping-discovery.mjs";

test("Google Shopping: Arabic-English mixed intent preserved without rewriting model, SKU or capacity",()=>{
  const query="آيفون 17 Pro Max 256GB  \t سامسونج";
  const raw=normalizeGoogleShoppingDiscoveryQuery(query);
  assert.equal(raw,"آيفون 17 Pro Max 256GB سامسونج");
  const url=new URL(buildGoogleShoppingDiscoveryUrl(query));
  assert.equal(url.origin,"https://www.google.com");
  assert.equal(url.pathname,"/search");
  assert.equal(url.searchParams.get("tbm"),"shop");
  assert.equal(url.searchParams.get("q"),raw);
  assert.equal(url.searchParams.get("gl"),"sa");
  assert.equal(url.searchParams.get("hl"),"ar");
});

test("Google Shopping: reserved URL characters are encoded as query, not parameters",()=>{
  const query="سماعات & laptops # Sony ? أيفون = 17";
  const url=new URL(buildGoogleShoppingDiscoveryUrl(query));
  assert.equal(url.searchParams.get("q"),query);
  assert.deepEqual([...url.searchParams.keys()],["tbm","q","gl","hl"]);
});

test("Google Shopping: no redirect or arbitrary destinations from HTML-like query",()=>{
  const url=new URL(buildGoogleShoppingDiscoveryUrl('"><img src=x onerror=alert(1)>'));
  assert.equal(url.hostname,"www.google.com");
  assert.equal(url.searchParams.get("q"),'\"><img src=x onerror=alert(1)>');
  assert.equal(url.searchParams.get("tbm"),"shop");
});

test("Google Shopping: refuse URL paste, control characters and oversized queries",()=>{
  for (const q of ["", " ", "a", "https://www.example.com/?secret=1",
      "www.example.com/product?q=99", "my\u0000query", "x\u202Ey",
      "x".repeat(201), null, 123]) {
    assert.equal(buildGoogleShoppingDiscoveryUrl(q),null,String(q));
  }
});

test("Google Shopping: 200-codepoint Arabic/emoji boundary is enforced",()=>{
  const raw="س".repeat(199)+"🎧";
  const url=buildGoogleShoppingDiscoveryUrl(raw);
  assert.equal(new URL(url).searchParams.get("q"),raw);
  assert.equal(buildGoogleShoppingDiscoveryUrl(raw+"ا"),null);
});

test("Google Shopping: descriptor cannot be mistaken for a priced merchant offer",()=>{
  const d=googleShoppingDiscoveryDescriptor("لابتوب HP 16GB");
  assert.equal(d.source,"google-shopping");
  assert.equal(d.kind,"external_search_handoff");
  assert.equal(d.method,"user_initiated_link_only");
  assert.equal(d.returnsOffers,false);
  assert.equal(d.verifiedPrices,0);
  assert.equal(d.comparableWithNawaa,false);
  assert.equal(d.saudiDeliveryVerified,null);
  assert.equal(d.productPrice,undefined);
  assert.equal(d.currency,undefined);
  assert.equal(googleShoppingDiscoveryDescriptor("https://example.com/p"),null);
});
