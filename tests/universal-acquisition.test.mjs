import test from "node:test";
import assert from "node:assert/strict";
import { toNawaaProduct } from "../server/nawaa-extractor.mjs";

test("Crawlee fallback-shaped offers map into NAWAA product schema",()=>{
  const offer={
    title:"HP Pavilion 14",
    image:"https://example.com/p.jpg",
    productPrice:2499,
    originalProductPrice:2699,
    originalCurrency:"SAR",
    availability:"in_stock",
    sourceUrl:"https://example.com/p/1",
    specs:{brand:"HP",modelNumber:"14-ew"},
    extraction:{crawlee:true,strategy:"json_ld",jsonLdProductFound:true}
  };
  const product=toNawaaProduct(offer,offer.sourceUrl);
  assert.equal(product.identity.brand,"HP");
  assert.equal(product.commerce.priceSAR,2499);
  assert.equal(product.source.canonicalUrl,offer.sourceUrl);
  assert.ok(product.quality.confidence>=0.6);
});
