import test from "node:test";
import assert from "node:assert/strict";
import {inspect1688SearchEvidence,canonical1688OfferUrl} from "../src/1688-html-evidence.mjs";

test("1688 Jarir-style: canonical product URL rejects lookalike and wrong paths",()=>{
  assert.equal(canonical1688OfferUrl("https://detail.1688.com/offer/123456789012.html"),
    "https://detail.1688.com/offer/123456789012.html");
  for(const url of ["https://detail.1688.com.evil.test/offer/123456789012.html",
      "http://detail.1688.com/offer/123456789012.html",
      "https://detail.1688.com/login",
      "https://www.1688.com/offer/123456789012.html"])
    assert.equal(canonical1688OfferUrl(url),null,url);
});
test("1688 Jarir-style: JSON-LD same-link CNY price is candidate, never retail claim",()=>{
  const payload={
      "@type":"Product",url:"https://detail.1688.com/offer/123456789012.html",
      offers:{"@type":"Offer",url:"https://detail.1688.com/offer/123456789012.html",
        priceCurrency:"CNY",price:"15"}
    };
  const html='<html><body><a href="https://detail.1688.com/offer/123456789012.html">item</a>'+
    '<script type="application/ld+json">'+JSON.stringify(payload)+'</script></body></html>';
  const v=inspect1688SearchEvidence(html);
  assert.equal(v.links,1);
  assert.equal(v.jsonLdProducts,1);
  assert.equal(v.currencyBoundPriceCandidates,1);
  assert.equal(v.independentlyVerifiedUnitPrices,0);
  assert.equal(v.publishedOffers,0);
});
test("1688 Jarir-style: foreign/cross-sell JSONLD never attests linked product price",()=>{
 const html='<a href="https://detail.1688.com/offer/123456789012.html">actual</a>'+
   '<script type="application/ld+json">'+JSON.stringify({"@type":"Product",
     url:"https://detail.1688.com/offer/999999999999.html",
     offers:{priceCurrency:"CNY",price:"0.10",url:"https://detail.1688.com/offer/999999999999.html"}})+
    '</script>';
 const v=inspect1688SearchEvidence(html);
 assert.equal(v.links,1);
 assert.equal(v.currencyBoundPriceCandidates,0);
 assert.equal(v.publishedOffers,0);
});
test("1688: 200 login shell must never be classified as catalog yield",()=>{
 const v=inspect1688SearchEvidence(
  "<html><a href='https://detail.1688.com/offer/123456789012.html'>item</a>请登录</html>");
 assert.equal(v.challenge,true);
 assert.equal(v.state,"CHALLENGE_OR_LOGIN_SHELL");
});
