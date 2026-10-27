import test from "node:test";
import assert from "node:assert/strict";
import {extractDecathlonScopedIdentity} from "../server/decathlon-product-evidence.mjs";
const host="https://decathlon.com.sa",url=host+"/products/own-product";
function fixture({canon=url,title="Kalenji Running Shoes",schemaName=title,sku="KAL-100",variant="12345",
  image="https://cdn.shopify.com/products/shoes.jpg",addDifferentVariant=false,addDifferentSku=false,
  metaTitle=title,schematicUrl=url}={}){
  const schema={ "@context":"https://schema.org","@type":"Product",name:schemaName,url:schematicUrl,
    offers:{"@type":"AggregateOffer",lowPrice:"1",priceCurrency:"SAR"}};
  return '<html><head><title>'+title+' | Decathlon</title><link rel="canonical" href="'+canon+'">'+
  '<meta property="og:title" content="'+metaTitle+'"><meta property="og:image" content="'+image+'"></head>'+
  '<body><main><h1>'+title+'</h1><div class="product" data-sku="'+sku+'"></div>'+
  (addDifferentSku?'<div class="upsell" data-sku="OTHER-SKU"></div>':"")+
  '<form action="/cart/add"><input name="id" value="'+variant+'"></form>'+
  '<form action="/cart/add"><input name="id" value="'+variant+'"></form>'+
  (addDifferentVariant?'<form action="/cart/add"><input name="id" value="77777"></form>':"")+
  '</main><script type="application/ld+json">'+JSON.stringify(schema)+'</script></body></html>';
}
test("RED: strict owned product identity can be extracted, but never a price/offer",()=>{
  const x=extractDecathlonScopedIdentity(fixture(),url);
  assert.equal(x.status,"SCOPED_IDENTITY_OBSERVED");
  assert.equal(x.identityProven,true);
  assert.equal(x.sku,"KAL-100");
  assert.equal(x.selectedVariant,"12345");
  assert.equal(x.image,"https://cdn.shopify.com/products/shoes.jpg");
  assert.equal(x.priceProven,false);
  assert.equal(x.inventoryProven,false);
  assert.equal("price" in x,false);
  assert.equal("offers" in x,false);
});
test("negative: another merchant, unrelated product URL, canonical conflict reject",()=>{
  assert.equal(extractDecathlonScopedIdentity(fixture(),"https://evil.example/products/own-product").status,"INVALID_SOURCE_URL");
  assert.equal(extractDecathlonScopedIdentity(fixture({canon:host+"/products/other"}),url).status,"CANONICAL_OWNERSHIP_NOT_VERIFIED");
  assert.equal(extractDecathlonScopedIdentity(fixture({schematicUrl:host+"/products/other"}),url).status,"SCHEMA_URL_CONFLICT");
});
test("negative: unrelated JSON-LD sibling cannot provide variant identity",()=>{
  assert.equal(extractDecathlonScopedIdentity(fixture({schemaName:"Other Product"}),url).status,"SCHEMA_SUBJECT_NOT_UNIQUE");
  assert.equal(extractDecathlonScopedIdentity(fixture({metaTitle:"Other Product"}),url).status,"SCHEMA_SUBJECT_NOT_UNIQUE");
});
test("negative: confusable variant IDs or SKU contradictions prevent identity promotion",()=>{
  assert.equal(extractDecathlonScopedIdentity(fixture({addDifferentSku:true}),url).status,"SKU_AMBIGUOUS");
  assert.equal(extractDecathlonScopedIdentity(fixture({addDifferentVariant:true}),url).status,"VARIANT_AMBIGUOUS");
  assert.equal(extractDecathlonScopedIdentity(fixture(),url+"?variant=99999").status,"VARIANT_URL_CONFLICT");
});
test("negative: image missing or non-TLS cannot become product image",()=>{
  assert.equal(extractDecathlonScopedIdentity(fixture({image:"http://unsafe.example/image"}),url).status,"IMAGE_EVIDENCE_MISSING");
  assert.equal(extractDecathlonScopedIdentity(fixture({image:""}),url).status,"IMAGE_EVIDENCE_MISSING");
});
test("negative: no SKU, no form, no canonical cannot be silently defaulted",()=>{
  assert.equal(extractDecathlonScopedIdentity(fixture({sku:""}),url).status,"SKU_AMBIGUOUS");
  assert.equal(extractDecathlonScopedIdentity(fixture({variant:""}),url).status,"VARIANT_AMBIGUOUS");
  assert.equal(extractDecathlonScopedIdentity(fixture({canon:""}),url).status,"CANONICAL_OWNERSHIP_NOT_VERIFIED");
});
