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
