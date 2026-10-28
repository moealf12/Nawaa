import test from "node:test";
import assert from "node:assert/strict";
import {EUROPE_SOURCES,inspectEuropeanOffer,sourceErrorClass,summarizeEuropeanProbe}
  from "../src/europe-source-yield.mjs";
const sample={
  providerMarket:"thomann-de",merchantCountryCode:"DE",dataKind:"live",
  title:"AKG K-240 Studio",sourceUrl:"https://www.thomann.de/de/akg_k_240_studio_kopfhoerer.htm?type=quickSearch",
  image:"https://cdn.thomann.de/akg-k240.jpg",productPrice:350,currency:"SAR",
  originalProductPrice:79.9,originalCurrency:"EUR",
  fx:{rate:4.38,source:"frankfurter",observedAt:"2026-10-28T15:00:00Z"},canShipToSaudi:null
};
test("all six EU pilots have bounded source specifications",()=>{
  assert.deepEqual(Object.keys(EUROPE_SOURCES),[
    "amazon-uk","amazon-de","mediamarkt-de","pccomponentes-es","bike24-de","thomann-de"
  ]);
});
test("valid field-level sample is explicitly not certified",()=>{
  assert.deepEqual(inspectEuropeanOffer("thomann-de",sample),{fieldsPass:true,issues:[]});
  const report=summarizeEuropeanProbe("thomann-de",{candidates:3,offers:[sample]});
  assert.equal(report.status,"FIELD_COMPLETE_NOT_ATTESTED");
  assert.equal(report.activationApproved,false);
  assert.equal(report.merchantAttested,false);
  assert.equal(report.saudiDeliveryVerified,false);
});
test("foreign host, credentials, search URL and malformed path fail provenance",()=>{
  for(const sourceUrl of [
    "https://www.thomann.de.evil.example/de/akg_k_240_studio_kopfhoerer.htm",
    "https://evil@www.thomann.de/de/akg_k_240_studio_kopfhoerer.htm",
    "https://www.thomann.de/de/search_dir.html?sw=akg",
    "https://www.thomann.de/de/../search_dir.html"
  ]){
    assert.ok(inspectEuropeanOffer("thomann-de",{...sample,sourceUrl}).issues.includes("PRODUCT_URL_PROVENANCE"));
  }
});
test("cross-market price provenance rejects ambiguous currency, invalid SAR, missing FX",()=>{
  for(const update of [
    {originalCurrency:"SAR"},{originalProductPrice:0},{productPrice:NaN},{currency:"EUR"},{fx:null}
  ])assert.equal(inspectEuropeanOffer("thomann-de",{...sample,...update}).fieldsPass,false);
});
test("EU delivery claim cannot be inferred from search result",()=>{
  assert.ok(inspectEuropeanOffer("thomann-de",{...sample,canShipToSaudi:true}).issues
    .includes("UNSUPPORTED_SAUDI_DELIVERY_CLAIM"));
  const media={...sample,providerMarket:"mediamarkt-de",
    sourceUrl:"https://www.mediamarkt.de/de/product/_apple-iphone-17-256-gb-1234567.html",
    canShipToSaudi:null};
  assert.ok(inspectEuropeanOffer("mediamarkt-de",media).issues.includes("UNSUPPORTED_SAUDI_DELIVERY_CLAIM"));
});
test("error classes and zero-yield states remain distinct",()=>{
  for(const [input,expected] of [
    ["HTTP 403","ACCESS_DENIED_OR_LIMITED"],
    ["HTTP 429","ACCESS_DENIED_OR_LIMITED"],
    ["HTTP 503","REMOTE_SERVICE_ERROR"],
    ["Product page request timed out","TIMEOUT"]
  ])assert.equal(sourceErrorClass(input),expected);
  assert.equal(summarizeEuropeanProbe("amazon-uk",null,new Error("HTTP 503")).status,"SOURCE_REQUEST_FAILED");
  assert.equal(summarizeEuropeanProbe("amazon-de",{candidates:0,offers:[]}).status,"NO_CANDIDATES");
  assert.equal(summarizeEuropeanProbe("thomann-de",{candidates:3,offers:[],diagnostics:{
    unpricedSamples:[{title:"AKG K-240 Studio"}]}}).status,"PRODUCTS_FOUND_PRICE_MISSING");
  assert.equal(summarizeEuropeanProbe("pccomponentes-es",null,new Error("HTTP 403")).status,"ACCESS_DENIED_OR_LIMITED");
});
test("wrong source identity, blank image and price prevent field pass",()=>{
  for(const update of [
    {providerMarket:"amazon-de"},{merchantCountryCode:"GB"},{dataKind:"fixture"},
    {image:"javascript:alert(1)"},{title:"x"},{sourceUrl:"http://www.thomann.de/de/item.htm"}
  ])assert.equal(inspectEuropeanOffer("thomann-de",{...sample,...update}).fieldsPass,false);
});
test("unknown merchant must not silently fall back",()=>{
  assert.throws(()=>summarizeEuropeanProbe("unknown",{}),/UNKNOWN_EUROPE_SOURCE/);
});
