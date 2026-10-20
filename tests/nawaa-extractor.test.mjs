import assert from "node:assert/strict";
import test from "node:test";
import { buildExtractionDiagnostics, toNawaaProduct } from "../server/nawaa-extractor.mjs";

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
  assert.equal(product.quality.confidence,0.93);
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


test("NAWAA extractor v2 consumes storefront resolver evidence", () => {
  const product = toNawaaProduct({
    title:"Storefront Live Product", image:"https://example.com/store.jpg", productPrice:199,
    originalCurrency:"SAR", sourceUrl:"https://example.com/products/live", availability:"in_stock",
    shipping:0, specs:{brand:"Storefront"},
    extraction:{storefrontProductFound:true,structuredPriceFound:true,structuredCurrencyFound:true},
  }, "https://example.com/products/live");
  assert.equal(product.quality.extractionStrategy,"storefront_data");
  assert.ok(product.quality.extractionTrail.includes("storefront_data"));
  assert.ok(product.quality.confidence > 0.7);
});


test("NAWAA extractor exposes adapter diagnostics for API consumers", () => {
  const product = toNawaaProduct({
    title:"Adapted Product",
    image:"https://example.com/a.jpg",
    productPrice:120,
    originalProductPrice:120,
    originalCurrency:"SAR",
    sourceUrl:"https://www.shein.com/item-p-123.html",
    availability:"in_stock",
    shipping:null,
    specs:{brand:"SHEIN"},
    extraction:{
      strategy:"domain_adapter",
      domainAdapterFound:true,
      domainAdapterId:"shein",
      availableDomainAdapters:["shein"],
      selectionReason:"domain_adapter_with_complete_price",
      attemptedStrategies:["jsonld","embedded_json","domain_adapter","meta"],
      availableStrategies:["domain_adapter","meta"],
      structuredPriceFound:true,
      structuredCurrencyFound:true
    },
  }, "https://www.shein.com/item-p-123.html");

  const diagnostics = buildExtractionDiagnostics(product);
  assert.equal(diagnostics.adapterId,"shein");
  assert.equal(diagnostics.selectedStrategy,"domain_adapter");
  assert.equal(diagnostics.selectionReason,"domain_adapter_with_complete_price");
  assert.deepEqual(diagnostics.availableDomainAdapters,["shein"]);
  assert.ok(diagnostics.missingFields.includes("shipping"));
  assert.ok(diagnostics.confidence > 0.5);
});


test("NAWAA diagnostics expose reconciliation sources", () => {
  const product = toNawaaProduct({
    title:"Merged Product",
    image:"https://example.com/m.jpg",
    productPrice:149,
    originalProductPrice:149,
    originalCurrency:"SAR",
    sourceUrl:"https://www.shein.com/item-p-123.html",
    availability:"in_stock",
    shipping:null,
    specs:{brand:"Brand X",modelNumber:"SKU-123"},
    extraction:{
      domainAdapterFound:true,
      domainAdapterId:"shein",
      reconciled:true,
      contributingStrategies:["jsonld","domain_adapter:shein"],
      fieldSources:{
        image:{strategy:"jsonld",adapterId:null},
        offers:{strategy:"domain_adapter",adapterId:"shein"}
      },
      structuredPriceFound:true,
      structuredCurrencyFound:true
    },
  }, "https://www.shein.com/item-p-123.html");

  const diagnostics = buildExtractionDiagnostics(product);
  assert.equal(diagnostics.reconciled,true);
  assert.deepEqual(diagnostics.contributingStrategies,["jsonld","domain_adapter:shein"]);
  assert.equal(diagnostics.fieldSources.image.strategy,"jsonld");
  assert.equal(diagnostics.fieldSources.offers.adapterId,"shein");
});

test("v19 RED — unconverted UAE value cannot be certified as SAR commerce price", () => {
  const offer = {
    title:"Sony PlayStation 5 Disc Edition",
    image:"https://merchant.example/ps5.webp",
    productPrice:800,
    originalProductPrice:800,
    currency:"AED",
    originalCurrency:"AED",
    sourceUrl:"https://merchant.example/ps5",
    merchant:"Fixture UAE Merchant",
    availability:"unknown",
    specs:{brand:"Sony",modelNumber:"CFI-2000"},
    extraction:{jsonLdProductFound:true,structuredPriceFound:true,structuredCurrencyFound:true},
  };
  const product=toNawaaProduct(offer,offer.sourceUrl);
  assert.equal(product.commerce.priceSAR,null,
    "unconverted AED must not enter a SAR-labeled price field");
  assert.equal(product.commerce.originalPrice,800);
  assert.equal(product.commerce.originalCurrency,"AED");
  assert.ok(product.quality.missingFields.includes("productPrice"));
});

test("v19 — verified AED conversion and native SAR stay eligible as SAR", () => {
  const base={title:"Verified international item",sourceUrl:"https://merchant.example/verified",
    image:"https://merchant.example/a.webp",availability:"in_stock",
    specs:{brand:"Merchant"},shipping:null};
  const verified=toNawaaProduct({...base,productPrice:835,currency:"SAR",
    originalCurrency:"AED",originalProductPrice:800,
    fx:{rate:1.04375,source:"documented",observedAt:"2026-10-20T00:00:00Z"},
    extraction:{structuredPriceFound:true,structuredCurrencyFound:true}},base.sourceUrl);
  assert.equal(verified.commerce.priceSAR,835);
  assert.equal(verified.commerce.originalPrice,800);
  const sa=toNawaaProduct({...base,productPrice:1199,currency:"SAR",
    originalCurrency:"SAR",originalProductPrice:1199},base.sourceUrl);
  assert.equal(sa.commerce.priceSAR,1199);
});
