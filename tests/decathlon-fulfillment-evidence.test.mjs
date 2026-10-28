import test from "node:test";
import assert from "node:assert/strict";
import {inspectShopifySelectedVariantAvailability} from "../server/shopify-page-variant.mjs";
import {evaluateDecathlonFulfillmentReadiness} from "../server/decathlon-fulfillment-evidence.mjs";
const url="https://decathlon.com.sa/products/source-shoe", variantUrl=url+"?variant=12345";
function page({cartId="12345",sku="SHOE-10",recordSku=sku,recordId="12345",
  availableForSale=undefined,available=undefined,inventoryQuantity=undefined,
  addDuplicate=false,metaAvailable=false}={}){
  const item={id:recordId,sku:recordSku,price:{amount:"99.00",currencyCode:"SAR"},
    product:{url:"/products/source-shoe",title:"Source Shoe"},title:"Default Title"};
  if(availableForSale!==undefined)item.availableForSale=availableForSale;
  if(available!==undefined)item.available=available;
  if(inventoryQuantity!==undefined)item.inventory_quantity=inventoryQuantity;
  const variants=[item];
  if(addDuplicate)variants.push({...item});
  const graph={"@type":"Product",name:"Source Shoe",url,
    ...(metaAvailable?{offers:{availability:"https://schema.org/InStock"}}:{})};
  return '<html><head><link rel="canonical" href="'+url+'">'+
    '<meta property="og:title" content="Source Shoe">'+
    '<meta name="twitter:image" content="https://decathlon.com.sa/cdn/source-shoe.jpg"></head>'+
    '<body><main><span data-sku="'+sku+'"></span>'+
    '<form action="/cart/add"><input name="id" value="'+cartId+'"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(graph)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify({productVariants:variants})+' });</script></body></html>';
}

test("RED: selected variant boolean true is a merchant signal, NOT physical stock or buyability proof",()=>{
  const info=inspectShopifySelectedVariantAvailability(page({availableForSale:true}),variantUrl,"SHOE-10");
  assert.equal(info.status,"SELECTED_VARIANT_AVAILABLE_SIGNAL");
  assert.equal(info.sourceSignal,"availableForSale");
  assert.equal(info.selectedVariantMatched,true);
  assert.equal(info.inventoryVerified,false);
  assert.equal(info.checkoutVerified,false);
  const readiness=evaluateDecathlonFulfillmentReadiness(page({availableForSale:true}),url);
  assert.equal(readiness.status,"VARIANT_AVAILABILITY_OBSERVED_DELIVERY_UNVERIFIED");
  assert.equal(readiness.merchantAvailableSignal,true);
  assert.equal(readiness.inventoryVerified,false);
  assert.equal(readiness.shippingVerified,false);
  assert.equal(readiness.quoteAllowed,false);
  assert.equal(readiness.trustedOfferEligible,false);
});
test("RED: explicit selected variant false is observed as source signal only, never promoted to stock claim",()=>{
  const info=inspectShopifySelectedVariantAvailability(page({availableForSale:false}),variantUrl,"SHOE-10");
  assert.equal(info.status,"SELECTED_VARIANT_UNAVAILABLE_SIGNAL");
  const r=evaluateDecathlonFulfillmentReadiness(page({availableForSale:false}),url);
  assert.equal(r.status,"VARIANT_UNAVAILABLE_SOURCE_SIGNAL");
  assert.equal(r.inventoryVerified,false);
  assert.equal(r.stockClaim,"unknown");
  assert.equal(r.shippingVerified,false);
});
test("RED: no per-variant signal, even when JSON-LD family says InStock, leaves inventory unknown",()=>{
  const html=page({metaAvailable:true});
  const info=inspectShopifySelectedVariantAvailability(html,variantUrl,"SHOE-10");
  assert.equal(info.status,"SELECTED_VARIANT_AVAILABILITY_UNKNOWN");
  assert.equal(evaluateDecathlonFulfillmentReadiness(html,url).status,"NO_VARIANT_AVAILABILITY_EVIDENCE");
});
test("RED: two contradictory same-variant availability flags are conflict, never choose true",()=>{
  const html=page({availableForSale:true,available:false});
  const info=inspectShopifySelectedVariantAvailability(html,variantUrl,"SHOE-10");
  assert.equal(info.status,"VARIANT_AVAILABILITY_CONFLICT");
  assert.equal(evaluateDecathlonFulfillmentReadiness(html,url).status,"VARIANT_AVAILABILITY_CONFLICT");
});
test("RED: another SKU or variant never donates its inventory to the selected product",()=>{
  for(const html of [page({recordSku:"OTHER-SKU",availableForSale:true}),
    page({recordId:"99999",availableForSale:true}),
    page({availableForSale:true,addDuplicate:true})]){
    const info=inspectShopifySelectedVariantAvailability(html,variantUrl,"SHOE-10");
    assert.equal(info.selectedVariantMatched,false);
    assert.equal(info.inventoryVerified,false);
    assert.equal(evaluateDecathlonFulfillmentReadiness(html,url).trustedOfferEligible,false);
  }
});
test("RED: numeric inventory_quantity without selected availability flag does not imply purchasable",()=>{
  const info=inspectShopifySelectedVariantAvailability(page({inventoryQuantity:10}),variantUrl,"SHOE-10");
  assert.equal(info.status,"SELECTED_VARIANT_AVAILABILITY_UNKNOWN");
  assert.equal(info.inventoryQuantityFieldPresent,true);
  assert.equal(info.inventoryVerified,false);
});
test("RED: shipping country and local merchant do not prove product-level delivery or checkout",()=>{
  const r=evaluateDecathlonFulfillmentReadiness(page({available:true}),url,{destinationCountry:"SA"});
  assert.equal(r.merchantAvailableSignal,true);
  assert.equal(r.shippingVerified,false);
  assert.equal(r.shippingPriceVerified,false);
  assert.equal(r.deliveryDestinationVerified,false);
  assert.equal(r.checkoutVerified,false);
  assert.equal(r.quoteAllowed,false);
});
test("RED: valid HTTP cannot be inferred from client-supplied output, foreign URLs, or rejected SKU evidence",()=>{
  for(const target of ["https://evil.example/products/source-shoe","http://decathlon.com.sa/products/source-shoe",
    url+"?variant=77777"]){
    const r=evaluateDecathlonFulfillmentReadiness(page({available:true}),target);
    assert.equal(r.trustedOfferEligible,false);
    assert.equal(r.inventoryVerified,false);
  }
});
test("RED: output contains no SKU, selected variant id, price, source URL or raw markup",()=>{
  const r=evaluateDecathlonFulfillmentReadiness(page({available:true}),url);
  const json=JSON.stringify(r);
  for(const secret of ["99.00","SHOE-10","12345","source-shoe","wpmLoader","https://"])
    assert.equal(json.includes(secret),false,secret);
});
