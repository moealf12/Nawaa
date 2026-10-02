import assert from "node:assert/strict";
import test from "node:test";
import { toNawaaProduct } from "../server/nawaa-extractor.mjs";

test("NAWAA extractor normalizes a verified product into stable schema", () => {
  const product = toNawaaProduct({
    title:"Test Product",
    image:"https://example.com/p.jpg",
    productPrice:100,
    originalProductPrice:100,
    originalCurrency:"SAR",
    sourceUrl:"https://example.com/p",
    merchant:"Example",
    providerMarket:"example-sa",
    merchantCountryCode:"SA",
    merchantCountryNameAr:"السعودية",
    availability:"in_stock",
    condition:"new",
    canShipToSaudi:true,
    shipping:0,
    specs:{brand:"Example",deviceType:"Model X",modelNumber:"X1",barcode:"123",color:"Black"},
    extraction:{jsonLdProductFound:true,structuredPriceFound:true,structuredCurrencyFound:true},
  }, "https://example.com/p");

  assert.equal(product.schemaVersion,"nawaa.product.v1");
  assert.equal(product.identity.brand,"Example");
  assert.equal(product.commerce.priceSAR,100);
  assert.equal(product.quality.extractionStrategy,"json_ld");
  assert.equal(product.quality.confidence,1);
  assert.deepEqual(product.quality.missingFields,[]);
});

test("NAWAA extractor reports incomplete fields and lowers confidence", () => {
  const product = toNawaaProduct({
    title:"Sparse Product",
    sourceUrl:"https://example.com/sparse",
    productPrice:null,
    originalCurrency:null,
    availability:"unknown",
    specs:{},
    extraction:{jsonLdProductFound:false,structuredPriceFound:false,structuredCurrencyFound:false},
  }, "https://example.com/sparse");

  assert.ok(product.quality.confidence < 0.5);
  assert.ok(product.quality.missingFields.includes("image"));
  assert.ok(product.quality.missingFields.includes("productPrice"));
  assert.ok(product.quality.missingFields.includes("specs.brand"));
});


test("NAWAA extractor v2 prioritizes embedded JSON over structured metadata", () => {
  const product = toNawaaProduct({
    title:"Hydrated Product", image:"https://example.com/h.jpg", productPrice:250,
    originalProductPrice:250, originalCurrency:"SAR", sourceUrl:"https://example.com/h",
    availability:"in_stock", shipping:0, specs:{brand:"Hydra"},
    extraction:{embeddedJsonProductFound:true,structuredPriceFound:true,structuredCurrencyFound:true},
  }, "https://example.com/h");
  assert.equal(product.extractorVersion,"2.0.0");
  assert.equal(product.quality.extractionStrategy,"embedded_json");
  assert.deepEqual(product.quality.extractionTrail,["embedded_json","structured_meta"]);
  assert.ok(product.quality.evidenceCount >= 3);
});

test("NAWAA extractor v2 recognizes storefront and domain-adapter evidence", () => {
  const storefront = toNawaaProduct({
    title:"Store Product", image:"https://example.com/s.jpg", productPrice:99,
    originalCurrency:"SAR", sourceUrl:"https://example.com/s", availability:"in_stock",
    shipping:0, specs:{brand:"Store"}, extraction:{shopifyProductFound:true},
  }, "https://example.com/s");
  assert.equal(storefront.quality.extractionStrategy,"storefront_data");

  const adapted = toNawaaProduct({
    title:"Adapted Product", image:"https://example.com/a.jpg", productPrice:120,
    originalCurrency:"SAR", sourceUrl:"https://example.com/a", availability:"in_stock",
    shipping:0, specs:{brand:"Adapter"}, extraction:{domainAdapterFound:true},
  }, "https://example.com/a");
  assert.equal(adapted.quality.extractionStrategy,"domain_adapter");
});


test("resolver extraction evidence maps into extractor v2 strategy names", () => {
  const jsonLd = toNawaaProduct({
    title:"JSON-LD Product", image:"https://example.com/j.jpg", productPrice:10,
    originalCurrency:"SAR", sourceUrl:"https://example.com/j", availability:"in_stock",
    shipping:0, specs:{brand:"JSON"}, extraction:{jsonLdProductFound:true,structuredPriceFound:true,structuredCurrencyFound:true},
  }, "https://example.com/j");
  assert.equal(jsonLd.quality.extractionStrategy,"json_ld");

  const hydrated = toNawaaProduct({
    title:"Hydrated Product", image:"https://example.com/h2.jpg", productPrice:10,
    originalCurrency:"SAR", sourceUrl:"https://example.com/h2", availability:"in_stock",
    shipping:0, specs:{brand:"Hydrated"}, extraction:{hydrationProductFound:true,structuredPriceFound:true,structuredCurrencyFound:true},
  }, "https://example.com/h2");
  assert.equal(hydrated.quality.extractionStrategy,"embedded_json");
});
