import test from "node:test";
import assert from "node:assert/strict";
import {attestDecathlonVariantPrice} from "../server/decathlon-variant-price-ownership.mjs";

const root="https://decathlon.com.sa",url=root+"/products/kalenji-shoes";
function template({sku="KAL-10",cartVariant="12345",recordVariant="12345",
    recordSku=sku,amount="99.00",currency="SAR",productUrl="/products/kalenji-shoes",
    title="Kalenji Shoes",recordTitle=title,includeVariant=true,extraVariants=[],image="https://decathlon.com.sa/cdn/shoes.jpg",
    metaPrice="89"}={}){
  const record={id:recordVariant,sku:recordSku,price:{amount,currencyCode:currency},
    image:{src:image},product:{url:productUrl,title:recordTitle},title:"Default Title"};
  const payload={productVariants:[...(includeVariant?[record]:[]),...extraVariants]};
  const schema={ "@context":"https://schema.org","@type":"Product",name:title,url};
  return '<html><head><link rel="canonical" href="'+url+'"><meta property="og:title" content="'+title+'">'+
    '<meta name="twitter:image" content="'+image+'"><meta property="product:price:amount" content="'+metaPrice+'">'+
    '<meta property="product:price:currency" content="SAR"></head><body>'+
    '<main><span data-sku="'+sku+'"></span><form action="/cart/add"><input name="id" value="'+cartVariant+'"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(schema)+'</script>'+
    '<script>window.foo=1; wpmLoader({ initData: '+JSON.stringify(payload)+' });</script></body></html>';
}
const check=(opts,urlArg=url)=>attestDecathlonVariantPrice(template(opts),urlArg);

test("positive: one exact same-SKU selected Shopify variant establishes price ownership but not trusted offer",()=>{
  const r=check({});
  assert.equal(r.status,"EXPLICIT_VARIANT_SKU_PRICE_OWNERSHIP");
  assert.equal(r.variantPriceOwned,true);
  assert.equal(r.trustedOfferEligible,false);
  assert.equal(r.inventoryVerified,false);
  assert.equal(r.shippingVerified,false);
  assert.equal(r.probes.hasVariantPayloadMarker,true);
  assert.equal(r.probes.hasMetaPrice,true);
  const serialized=JSON.stringify(r);
  for(const privateValue of ["99.00","KAL-10","12345","kalenji-shoes"])assert.equal(serialized.includes(privateValue),false);
});
test("negative: page-level Meta price never establishes SKU price without explicit variant record",()=>{
  const r=check({includeVariant:false});
  assert.equal(r.status,"NO_SELECTED_VARIANT_PRICE_RECORD");
  assert.equal(r.variantPriceOwned,false);
  assert.equal(r.probes.hasMetaPrice,true);
});
test("negative: cross-SKU priced variant cannot borrow current SKU",()=>{
  const r=check({recordSku:"OTHER-SKU"});
  assert.equal(r.status,"VARIANT_SKU_CONFLICT");
  assert.equal(r.variantPriceOwned,false);
});
test("negative: off-variant priced record cannot borrow selected page variant",()=>{
  const r=check({recordVariant:"99999"});
  assert.equal(r.status,"NO_SELECTED_VARIANT_PRICE_RECORD");
  assert.equal(r.variantPriceOwned,false);
});
test("negative: duplicate selected records are ambiguous",()=>{
  const duplicate={id:"12345",sku:"KAL-10",price:{amount:"10",currencyCode:"SAR"},
    product:{url:"/products/kalenji-shoes",title:"Kalenji Shoes"}};
  const r=check({extraVariants:[duplicate]});
  assert.equal(r.status,"NO_SELECTED_VARIANT_PRICE_RECORD");
});
test("negative: mismatched product path, title or price currency remain unverified",()=>{
  assert.equal(check({productUrl:"/products/different"}).variantPriceOwned,false);
  assert.equal(check({productUrl:"https://evil.example/products/kalenji-shoes"}).variantPriceOwned,false);
  assert.equal(check({recordTitle:"Kalenji Other Model"}).status,"VARIANT_PRODUCT_TITLE_CONFLICT");
  assert.equal(check({currency:"USD"}).status,"SELECTED_VARIANT_PRICE_NOT_SAR");
  assert.equal(check({amount:"0"}).variantPriceOwned,false);
});
test("negative: invalid requested domain or URL variant never promotes price",()=>{
  assert.equal(check({},"https://evil.example/products/kalenji-shoes").status,"SOURCE_URL_INVALID");
  assert.equal(check({},"https://decathlon.com.sa/products/kalenji-shoes?variant=12345").status,"SOURCE_URL_INVALID");
});
test("negative: missing or conflicting page identity blocks price attribution first",()=>{
  const r=check({sku:""});
  assert.equal(r.status,"IDENTITY_NOT_VERIFIED");
  assert.equal(r.variantPriceOwned,false);
});
