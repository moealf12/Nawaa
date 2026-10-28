import assert from "node:assert/strict";
import test from "node:test";
import {extractBike24PdpJsonLd} from "../src/bike24-pdp-jsonld.mjs";

const URL="https://www.bike24.com/p2735527.html";
const product={
  "@type":"Product",name:"Garmin Edge 540 GPS Cycling Computer - black",
  url:URL,mpn:"010-02694-01",gtin13:"753759299811",
  image:"https://www.bike24.com/images/edge540.jpg",
  offers:{"@type":"Offer",price:"247.05",priceCurrency:"EUR",url:URL},
};
const html=(...nodes)=>'<html><head><script type="application/ld+json">'+JSON.stringify({
  "@context":"https://schema.org","@graph":nodes
})+'</script></head><body><main><h1>Garmin Edge 540</h1></main></body></html>';

test("G.2 PDP embedded JSON-LD exact Garmin identity, price, source",()=>{
  const got=extractBike24PdpJsonLd(html(product),URL);
  assert.equal(got?.originalProductPrice,247.05);
  assert.equal(got?.originalCurrency,"EUR");
  assert.equal(got?.edition,"STANDARD");
  assert.equal(got?.retailerProductId,"2735527");
  assert.equal(got?.mpn,"010-02694-01");
  assert.equal(got?.gtin,"753759299811");
  assert.match(got.identityHash,/^[0-9a-f]{64}$/);
  assert.equal(got.sourceMeta.priceEvidence,"PDP_JSONLD_OBSERVED_ONLY");
  assert.equal(got.sourceMeta.merchantAttested,false);
  assert.equal(got.sourceMeta.saudiShippingVerified,false);
});

test("G.2 PDP rejects forged source URL, unrelated SKU and Solar variant",()=>{
  assert.equal(extractBike24PdpJsonLd(html(product),"https://www.bike24.com.evil.test/p2735527.html"),null);
  assert.equal(extractBike24PdpJsonLd(html({...product,url:"https://www.bike24.com/p2735528.html"}),URL),null);
  const solar={...product,name:"Garmin Edge 540 Solar GPS Cycling Computer",url:"https://www.bike24.com/p2735528.html"};
  assert.equal(extractBike24PdpJsonLd(html(solar),URL),null);
  assert.equal(extractBike24PdpJsonLd(html({...product,offers:{...product.offers,url:"https://www.bike24.com/p2735528.html"}}),URL),null);
});

test("G.2 PDP rejects unrelated card offers, aggregate prices, and other currencies",()=>{
  const related={...product,url:"https://www.bike24.com/p2735599.html",offers:{...product.offers,price:99}};
  assert.equal(extractBike24PdpJsonLd(html(related,product),URL)?.originalProductPrice,247.05);
  assert.equal(extractBike24PdpJsonLd(html({...product,offers:{...product.offers,"@type":"AggregateOffer"}}),URL),null);
  assert.equal(extractBike24PdpJsonLd(html({...product,offers:{...product.offers,priceCurrency:"USD"}}),URL),null);
  assert.equal(extractBike24PdpJsonLd(html({...product,image:"https://evil.example/edge540.jpg"}),URL),null);
});

test("G.2 PDP contradictory same-product JSON-LD offers cannot be combined",()=>{
  const mismatch={...product,offers:{...product.offers,price:"247.06"}};
  assert.equal(extractBike24PdpJsonLd(html(product,mismatch),URL),null);
  const foreignGtin={...product,gtin13:"1234567890123"};
  assert.equal(extractBike24PdpJsonLd(html(product,foreignGtin),URL),null);
  assert.equal(extractBike24PdpJsonLd(html(product),URL,{observedAt:"2026-10-28T18:00:00Z"})?.observedAt,"2026-10-28T18:00:00Z");
});

test("G.2 PDP refuses invented JSON-LD when document contains only a visible price",()=>{
  const htmlOnly="<html><body><main><h1>Garmin Edge 540</h1><p>247,05 €</p></main></body></html>";
  assert.equal(extractBike24PdpJsonLd(htmlOnly,URL),null);
});
