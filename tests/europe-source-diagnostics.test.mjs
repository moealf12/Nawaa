import assert from "node:assert/strict";
import test from "node:test";
import {diagnoseAmazonGermanyHtml} from "../src/europe-source-diagnostics.mjs";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";

const asin="B012345678";
const card=(price="")=>'<div data-asin="'+asin+'"><h2>Apple iPhone 17 256GB</h2>'+
  (price?'<span class="a-price"><span class="a-offscreen">'+price+'</span></span>':"")+
  '<a href="/dp/'+asin+'">Product</a></div>';

test("Amazon Germany evidence distinguishes no ASIN, missing price, extracted card",()=>{
  const empty=diagnoseAmazonGermanyHtml("<main>No items</main>");
  assert.equal(empty.classification,"NO_ASIN_MARKERS");
  assert.equal(empty.asinMarkers,0);
  assert.equal(diagnoseAmazonGermanyHtml(card(),{}).classification,
    "ASIN_MARKERS_WITHOUT_PRICE_MARKERS");
  assert.equal(diagnoseAmazonGermanyHtml(card("1.299,00 €"),{
    extractedCards:0,
  }).classification,"ASIN_MARKERS_WITH_UNEXTRACTED_PRICES");
  const found=diagnoseAmazonGermanyHtml(card("1.299,00 €"),{extractedCards:1});
  assert.equal(found.classification,"EXTRACTED_PRICED_CARDS");
  assert.equal(found.asinMarkers,1);
  assert.equal(found.merchantInventoryVerified,false);
  assert.equal(found.merchantAccessCauseVerified,false);
});
test("Page-level captcha is suspected only with a matching page signature",()=>{
  assert.equal(diagnoseAmazonGermanyHtml("<title>Robot Check</title>").classification,
    "CHALLENGE_PAGE_SUSPECTED");
  assert.equal(diagnoseAmazonGermanyHtml(card()+"Robot Check").classification,
    "ASIN_MARKERS_WITHOUT_PRICE_MARKERS");
  assert.equal(diagnoseAmazonGermanyHtml("").classification,"HTML_NOT_OBSERVED");
  assert.equal(JSON.stringify(diagnoseAmazonGermanyHtml("<script>secret-token</script>")).includes("secret-token"),false);
});
test("Amazon Germany mock search publishes safe diagnostic after only one HTML request",{concurrency:false},async()=>{
  const original=globalThis.fetch;
  const requests=[];
  try{
    globalThis.fetch=async url=>{
      requests.push(String(url));
      return new Response(card(),{status:200,headers:{"content-type":"text/html"}});
    };
    const result=await searchFreeStorefrontById("amazon-de","iphone 17",{perStore:2});
    assert.equal(requests.length,1);
    assert.ok(requests[0].startsWith("https://www.amazon.de/s?"));
    assert.equal(result.offers.length,0);
    assert.equal(result.diagnostics.amazonDeAcquisition.classification,
      "ASIN_MARKERS_WITHOUT_PRICE_MARKERS");
    assert.equal(result.diagnostics.amazonDeAcquisition.asinMarkers,1);
  }finally{globalThis.fetch=original;}
});
