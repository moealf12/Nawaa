import test from "node:test";
import assert from "node:assert/strict";
import {retainAcquiredStorefrontOffers} from "../server/search-offer-admission.mjs";
import {filterQueryOffers,assessOfferMatch} from "../src/search-query.mjs";
import {classifyResultGroup} from "../src/search-result-intelligence.mjs";

const offer=(title,overrides={})=>({
  title,merchant:"Independent live storefront",provider:"free-storefronts",
  providerMarket:"generic-store",productPrice:169.5,currency:"SAR",
  condition:"new",availability:"unknown",
  sourceUrl:"https://store.example/products/retail-item-123",
  sourceMeta:{priceEvidence:"SEARCH_CARD_ONLY"},
  specs:{},exactMatch:false,matchConfidence:0.9,...overrides,
});

test("R04 boundary: priced accessories survive early source filtering but never become direct phones",()=>{
  const query="Samsung Galaxy S25 Ultra";
  const caseOffer=offer("Samsung Galaxy S25 Ultra Protective Case");
  assert.equal(filterQueryOffers(query,[caseOffer]).offers.length,0,
    "documents the original source-side early-loss defect");
  const result=retainAcquiredStorefrontOffers(query,[caseOffer]);
  assert.equal(result.offers.length,1);
  assert.deepEqual(result.queryFilter,{input:1,retained:1,removed:0});
  const item=result.offers[0];
  assert.equal(item.exactMatch,false);
  const classified=classifyResultGroup(query,{bestOffer:{...item,...assessOfferMatch(query,item)}});
  assert.equal(classified.lane,"accessory");
  assert.equal(item.productPrice,169.5);
  assert.equal(item.sourceUrl,caseOffer.sourceUrl);
  assert.equal(item.sourceMeta,caseOffer.sourceMeta);
});

test("R04 boundary: source metadata cannot forge exact matching; unrelated titles remain excluded",()=>{
  const query="iPhone 17";
  const fake=offer("Handmade ceramic coffee mug",{
    exactMatch:true,matchConfidence:1,brand:"Apple",
  });
  const unrelated=offer("Wool Scarf For Winter");
  const result=retainAcquiredStorefrontOffers(query,[fake,unrelated]);
  assert.equal(result.offers.length,0);
  assert.equal(result.queryFilter.removed,2);
});

test("R04 boundary: strict source-proven principal and other valid related products remain visible without price mutation",()=>{
  const query="iPhone 17";
  const product=offer("Apple iPhone 17 256GB Black",{
    productPrice:3199,sourceUrl:"https://store.example/products/iphone-17-256",
  });
  const related=offer("Apple iPhone 17 Slim Protective Case",{
    productPrice:69,sourceUrl:"https://store.example/products/iphone-17-case",
  });
  const result=retainAcquiredStorefrontOffers(query,[product,related]);
  assert.equal(result.offers.length,2);
  const direct=result.offers.find(x=>x.productPrice===3199);
  const accessory=result.offers.find(x=>x.productPrice===69);
  assert.equal(direct.exactMatch,false,"merchant search card never receives fake exact certification");
  assert.equal(assessOfferMatch(query,direct).exactMatch,true);
  assert.equal(classifyResultGroup(query,{bestOffer:{...direct,...assessOfferMatch(query,direct)}}).lane,"direct");
  assert.equal(accessory.exactMatch,false);
  assert.notEqual(classifyResultGroup(query,{bestOffer:{...accessory,...assessOfferMatch(query,accessory)}}).lane,"direct");
  assert.equal(product.exactMatch,false,"never mutate independently acquired merchant evidence");
  assert.equal(related.exactMatch,false);
});

test("R04 boundary: cannot resurrect wrong-model cards or perfume packaging on generic category search",()=>{
  const wrong=offer("Samsung Galaxy S26 256GB");
  const same=offer("Samsung Galaxy S25 256GB");
  const model=retainAcquiredStorefrontOffers("galaxy s25 256gb",[wrong,same]);
  assert.deepEqual(model.offers.map(x=>x.title),[same.title]);
  const broad=retainAcquiredStorefrontOffers("perfume",[
    offer("Niceone Musk Eau De Perfume"),
    offer("Empty Perfume Bottle Atomizer"),
  ]);
  assert.deepEqual(broad.offers.map(x=>x.title),["Niceone Musk Eau De Perfume"]);
  assert.deepEqual(broad.queryFilter,{input:2,retained:1,removed:1});
});

test("R04 boundary: the live adapter must actually call central admission before customer publication",async()=>{
  const {readFileSync}=await import("node:fs");
  const code=readFileSync(new URL("../server/providers/free-storefronts.mjs",import.meta.url),"utf8");
  assert.match(code,/retainAcquiredStorefrontOffers\(matchingQuery, variantEligible\)/);
  assert.match(code,/thomannVariantMatchesQuery\(matchingQuery,offer\.title,offer\.sourceUrl\)/);
  assert.match(code,/moneyToSAR\(item\.price, item\.currency\)/);
});
