import assert from "node:assert/strict";
import test from "node:test";
import { reconcileProductCandidates } from "../server/product-reconciliation.mjs";

test("reconciliation merges JSON-LD identity with domain-adapter price and SKU", () => {
  const candidates = [
    {
      strategy:"jsonld",
      confidence:0.99,
      product:{
        name:"Premium Product",
        image:"https://example.com/p.jpg",
        brand:{name:"Brand X"},
        offers:{availability:"https://schema.org/InStock"},
      },
    },
    {
      strategy:"domain_adapter",
      adapterId:"shein",
      confidence:0.96,
      product:{
        name:"Premium Product",
        sku:"SKU-123",
        offers:{price:149,priceCurrency:"SAR",availability:"instock"},
      },
    },
  ];

  const selected = candidates[1];
  const result = reconcileProductCandidates(candidates, selected);

  assert.equal(result.product.name,"Premium Product");
  assert.equal(result.product.image,"https://example.com/p.jpg");
  assert.equal(result.product.brand,"Brand X");
  assert.equal(result.product.mpn,"SKU-123");
  assert.equal(result.product.offers.price,149);
  assert.equal(result.product.offers.priceCurrency,"SAR");
  assert.equal(result.reconciled,true);
  assert.ok(result.contributingStrategies.includes("jsonld"));
  assert.ok(result.contributingStrategies.includes("domain_adapter:shein"));
  assert.equal(result.fieldSources.image.strategy,"jsonld");
  assert.equal(result.fieldSources.mpn.adapterId,"shein");
  assert.equal(result.fieldSources.offers.adapterId,"shein");
});

test("reconciliation keeps one-source products stable", () => {
  const candidates = [{
    strategy:"jsonld",
    confidence:0.99,
    product:{
      name:"Complete Product",
      image:"https://example.com/c.jpg",
      brand:"Brand",
      mpn:"M-1",
      offers:{price:100,priceCurrency:"SAR",availability:"instock"},
    },
  }];

  const result = reconcileProductCandidates(candidates,candidates[0]);
  assert.equal(result.product.name,"Complete Product");
  assert.equal(result.product.offers.price,100);
  assert.equal(result.reconciled,false);
  assert.deepEqual(result.contributingStrategies,["jsonld"]);
});
