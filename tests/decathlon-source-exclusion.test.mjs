import test from "node:test";
import assert from "node:assert/strict";
import {configuredFreeStorefronts,routeFreeStorefronts,searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {WORLD_SOURCE_REGISTRY,buildSourceRegistry,isExcludedMerchantSource} from "../src/source-registry.mjs";
import {configuredShopifyStores} from "../server/providers/shopify.mjs";
import {currentSources} from "../server/source-config.mjs";

test("Decathlon is not a configured, routed or published NAWAA first-party source",async()=>{
  assert.equal(configuredFreeStorefronts().some(s=>s.id==="decathlon-sa"),false);
  assert.equal(WORLD_SOURCE_REGISTRY.some(s=>s.id==="decathlon-sa"),false);
  assert.equal(currentSources().some(s=>s.id==="decathlon-sa"),false);
  for(const query of ["ديكاتلون running shoes","decathlon hiking shoes","sports shoes"]){
    assert.equal(routeFreeStorefronts(query).some(entry=>entry.store.id==="decathlon-sa"),false);
  }
  await assert.rejects(searchFreeStorefrontById("decathlon-sa","hiking"),/unknown storefront/);
});

test("Stale configured providers and direct storefront/Shopify records cannot restore excluded merchant",()=>{
  const fake={
    id:"decathlon-sa",name:"Decathlon Saudi",countryCode:"SA",countryNameAr:"السعودية",
    baseUrl:"https://www.decathlon.com.sa",
  };
  const sources=buildSourceRegistry({
    configuredProviders:["free-storefronts:decathlon-sa","shopify"],
    storefronts:[fake],
    shopifyStores:[fake],
  });
  assert.equal(sources.some(s=>s.id==="decathlon-sa" || s.id==="shopify:decathlon-sa"),false);
  assert.equal(isExcludedMerchantSource({id:"another-id",name:"Another Shop",baseUrl:"https://shop.decathlon.co.uk"}),true);
  assert.equal(isExcludedMerchantSource({name:"Generic Seller",baseUrl:"https://decathlon.com.sa/products/x"}),true);
  assert.equal(isExcludedMerchantSource({id:"sports-shop",name:"Sports Shop",baseUrl:"https://example.com"}),false);
});

test("Shopify merchant configuration refuses excluded domain but preserves unrelated stores",()=>{
  const prior=process.env.SHOPIFY_STORES_JSON;
  try{
    process.env.SHOPIFY_STORES_JSON=JSON.stringify([
      {id:"decathlon-sa",name:"Decathlon Saudi",countryCode:"SA",baseUrl:"https://decathlon.com.sa"},
      {id:"sports-alias",name:"Sports Alias",countryCode:"SA",baseUrl:"https://www.decathlon.com.sa"},
      {id:"other",name:"Independent Store",countryCode:"SA",baseUrl:"https://example.com"},
    ]);
    assert.deepEqual(configuredShopifyStores().map(s=>s.id),["other"]);
  } finally{
    if(prior===undefined)delete process.env.SHOPIFY_STORES_JSON;
    else process.env.SHOPIFY_STORES_JSON=prior;
  }
});
