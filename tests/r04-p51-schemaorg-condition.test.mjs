import test from "node:test";
import assert from "node:assert/strict";
import {normalizeCondition} from "../server/provider-utils.mjs";

test("R04-P51 RED: standard Schema.org OfferItemCondition URLs identify the item condition",()=>{
  assert.equal(normalizeCondition("https://schema.org/NewCondition"),"new");
  assert.equal(normalizeCondition("https://schema.org/UsedCondition"),"used");
  assert.equal(normalizeCondition("https://schema.org/RefurbishedCondition"),"refurbished");
  assert.equal(normalizeCondition("NewCondition"),"new");
  assert.equal(normalizeCondition("UsedCondition"),"used");
  assert.equal(normalizeCondition("RefurbishedCondition"),"refurbished");
});

test("R04-P51: unsafe URLs, missing evidence and other Schema.org enums are not new",()=>{
  for(const raw of ["","https://not-schema.org/NewCondition",
    "https://merchant.invalid/path/new", "https://schema.org/DamagedCondition",
    "https://schema.org/NewCondition?product=used",
    "https://schema.org/NewCondition#untrusted",
    { "@id": "https://not-schema.org/NewCondition" },
    "javascript:new","data:text/plain,new","not new","non-new",
    "not brand new"]){
    assert.equal(normalizeCondition(raw),"unknown");
  }
  assert.equal(normalizeCondition({"@id":"https://schema.org/NewCondition"}),"new");
});

test("R04-P51: existing exact retail conditions remain backwards-compatible",()=>{
  for(const [input,wanted] of [
    ["new","new"],["brand new","new"],["used","used"],
    ["open box","open_box"],["renewed","refurbished"],
    ["refurbished","refurbished"],["pre owned","used"],
  ])assert.equal(normalizeCondition(input),wanted,input);
});

test("R04-P51: selected priced Offer condition is recovered, but never guessed",async()=>{
  const {resolveAssociatedItemCondition}=await import("../server/product-condition-evidence.mjs");
  assert.deepEqual(resolveAssociatedItemCondition(
    {name:"iPhone",offers:{price:1000}},{raw:{price:1000,
      itemCondition:"https://schema.org/NewCondition"}}),
    {condition:"new",evidence:"SELECTED_PRICED_OFFER"});
  assert.deepEqual(resolveAssociatedItemCondition(
    {name:"Laptop",itemCondition:"https://schema.org/RefurbishedCondition"},
    {raw:{price:1500,itemCondition:"RefurbishedCondition"}}),
    {condition:"refurbished",evidence:"PRODUCT_AND_SELECTED_OFFER"});
  assert.deepEqual(resolveAssociatedItemCondition({},null),
    {condition:"unknown",evidence:"ABSENT"});
  assert.deepEqual(resolveAssociatedItemCondition(
    {itemCondition:"https://schema.org/UsedCondition"},null),
    {condition:"used",evidence:"PRODUCT"});
});

test("R04-P51 negative: mismatched or unverified statements cannot promote a product",async()=>{
  const {resolveAssociatedItemCondition}=await import("../server/product-condition-evidence.mjs");
  for(const [product,offer] of [
    [{itemCondition:"https://schema.org/NewCondition"},
      {raw:{itemCondition:"https://schema.org/UsedCondition",price:80}}],
    [{itemCondition:"https://schema.org/RefurbishedCondition"},
      {raw:{itemCondition:"https://schema.org/NewCondition",price:90}}],
    [{itemCondition:"https://schema.org/DamagedCondition"},
      {raw:{itemCondition:"https://schema.org/NewCondition",price:90}}],
    [{itemCondition:"unrecognizedCondition"},
      {raw:{itemCondition:"NewCondition",price:90}}],
    [{itemCondition:{"@id":"https://schema.org/NewCondition","name":"UsedCondition"}},
      {raw:{itemCondition:"NewCondition",price:90}}],
  ]){
    assert.equal(resolveAssociatedItemCondition(product,offer).condition,"unknown");
  }
  assert.deepEqual(resolveAssociatedItemCondition({},{raw:{
    itemCondition:"https://untrusted.example/NewCondition"}}),
    {condition:"unknown",evidence:"UNVERIFIED"});
});

test("R04-P51: embedded exact single Offer itemCondition stays attached to correct Product",async()=>{
  const {extractionCandidates}=await import("../server/url-resolver.mjs");
  const {resolveAssociatedItemCondition}=await import("../server/product-condition-evidence.mjs");
  const page="https://merchant.example/products/ps5-ssd-1tb";
  const product={"@context":"https://schema.org","@type":"Product",
    name:"PS5 NVMe SSD 1TB",url:page,sku:"SSD1",
    offers:{"@type":"Offer",price:"399",priceCurrency:"SAR",
      url:page,itemCondition:"https://schema.org/NewCondition"}};
  const html='<script type="application/ld+json">'+JSON.stringify(product)+'</script>';
  const entries=extractionCandidates(html,page);
  const pdp=entries.find(x=>x.strategy==="jsonld");
  assert.ok(pdp?.product);
  assert.equal(pdp.product.offers.price,"399");
  assert.equal(resolveAssociatedItemCondition(pdp.product,
    {raw:pdp.product.offers}).condition,"new");
});

test("R04-P51: resolver uses only identity-qualified selected priced Offer",async()=>{
  const {readFileSync}=await import("node:fs");
  const resolver=readFileSync(new URL("../server/url-resolver.mjs",import.meta.url),"utf8");
  assert.match(resolver,/const offer = chooseOffer\(product\)/);
  assert.match(resolver,/resolveAssociatedItemCondition\(product,offer\)/);
  assert.match(resolver,/conditionEvidence/);
  assert.doesNotMatch(resolver,/const rawCondition = product && product\.itemCondition/);
});
