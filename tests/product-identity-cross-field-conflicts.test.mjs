import test from "node:test";
import assert from "node:assert/strict";
import { compareProductIdentity, identityCluster } from "../server/product-identity.mjs";
import { reconcileProductCandidates } from "../server/product-reconciliation.mjs";

const price = { price: 2999, priceCurrency: "SAR", availability: "instock" };
const entry = (strategy, product, confidence = 0.96) => ({
  strategy, confidence, product,
});

test("P0: a conflicting HP RAM-model cannot donate an image to the priced 8GB variant", () => {
  const priced = entry("domain_adapter", {
    name: "HP Pavilion 15 Laptop 8GB RAM", brand: "HP", mpn: "HP-8GB",
    offers: price,
  });
  const adjacent = entry("jsonld", {
    name: "HP Pavilion 15 Laptop 16GB RAM", brand: "HP", mpn: "HP-16GB",
    image: "https://merchant.example/images/hp-16gb.jpg",
    offers: { price: 3499, priceCurrency: "SAR" },
  }, 0.99);

  const identity = compareProductIdentity(priced.product, adjacent.product);
  assert.ok(identity.conflicts.includes("model"), "fixture must demonstrate an explicit model conflict");
  const result = reconcileProductCandidates([priced, adjacent], priced);
  assert.equal(result.product.offers.price, 2999, "keep the chosen priced 8GB record");
  assert.equal(result.product.mpn, "HP-8GB", "keep the priced record's model");
  assert.equal(result.product.image, null, "must not associate a 16GB image with the 8GB price");
  assert.equal(result.fieldSources.image, null);
  assert.equal(result.identity.summary.rejected, 1, "the conflicting record must be excluded");
});

test("P0: shared merchant SKU does not override a contradictory manufacturer model", () => {
  const anchor = entry("domain_adapter", {
    name: "HP Pavilion 15 Laptop", brand: "HP", sku: "STORE-LISTING-44",
    mpn: "MFR-8GB", offers: price,
  });
  const adjacent = entry("jsonld", {
    name: "HP Pavilion 15 Laptop", brand: "HP", sku: "STORE-LISTING-44",
    mpn: "MFR-16GB", image: "https://merchant.example/images/16gb.jpg",
  });
  const comparison = compareProductIdentity(anchor.product, adjacent.product);
  assert.ok(comparison.conflicts.includes("model"));
  const result = reconcileProductCandidates([anchor, adjacent], anchor);
  assert.equal(result.product.image, null);
  assert.equal(result.identity.summary.rejected, 1);
});

for (const field of ["sku", "gtin13", "brand"]) {
  test(`P0: explicit ${field} disagreement cannot contaminate a matching product title`, () => {
    const anchorProduct = {
      name: "Apple iPhone 17 Pro 256GB", brand: "Apple", sku: "LIST-1",
      gtin13: "1234567890123", offers: price,
    };
    const adjacentProduct = {
      ...anchorProduct,
      image: "https://merchant.example/images/different-product.jpg",
      [field]: field === "brand" ? "Samsung" : field === "sku" ? "LIST-2" : "9999999999999",
    };
    const anchor = entry("domain_adapter", anchorProduct);
    const adjacent = entry("jsonld", adjacentProduct);
    const comparison = compareProductIdentity(anchorProduct, adjacentProduct);
    assert.ok(comparison.conflicts.includes(field === "gtin13" ? "gtin" : field));
    const clustered = identityCluster([anchor, adjacent], anchor);
    assert.equal(clustered.summary.rejected, 1, "explicit strong conflict must never be included as uncertain");
    assert.equal(reconcileProductCandidates([anchor, adjacent], anchor).product.image, null);
  });
}

test("P0 positive: incomplete but consistent identity can supply missing image", () => {
  const anchor = entry("domain_adapter", {
    name: "HP Pavilion 15 Laptop 8GB RAM", brand: "HP", mpn: "HP-8GB",
    offers: price,
  });
  const consistent = entry("jsonld", {
    name: "HP Pavilion 15 Laptop 8GB RAM", brand: "HP",
    image: "https://merchant.example/images/8gb.jpg",
  }, 0.99);
  const result = reconcileProductCandidates([anchor, consistent], anchor);
  assert.equal(result.product.image, "https://merchant.example/images/8gb.jpg");
  assert.equal(result.identity.summary.rejected, 0);
  assert.equal(result.product.offers.price, 2999);
});

test("P0 positive: identical explicit identifiers preserve valid multi-source enrichment", () => {
  const anchor = entry("domain_adapter", {
    name: "HP Pavilion 15 Laptop", brand: "HP", sku: "STORE-LISTING-44",
    mpn: "MFR-8GB", offers: price,
  });
  const consistent = entry("jsonld", {
    name: "HP Pavilion 15 Laptop", brand: "HP", sku: "STORE-LISTING-44",
    mpn: "MFR-8GB", image: "https://merchant.example/images/8gb.jpg",
  }, 0.99);
  const result = reconcileProductCandidates([anchor, consistent], anchor);
  assert.equal(result.product.image, "https://merchant.example/images/8gb.jpg");
  assert.equal(result.identity.summary.rejected, 0);
});
