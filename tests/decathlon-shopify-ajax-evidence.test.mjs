import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveDecathlonAjaxUrl,evaluateDecathlonRobotsPolicy,
  compareDecathlonAjaxProductWithPdp,
} from "../server/decathlon-shopify-ajax-evidence.mjs";
const base="https://decathlon.com.sa",pdpUrl=base+"/products/test-shoes",ajaxUrl=pdpUrl+".js";
const robots="User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\nDisallow: /products/*?*\n";
function html(){
  const schema={"@type":"Product",name:"Test Shoes",url:pdpUrl};
  const payload={productVariants:[{id:"12345",sku:"SKU-ABC",price:{amount:"49.00",currencyCode:"SAR"},product:{url:"/products/test-shoes",title:"Test Shoes"}}]};
  return '<html><head><link rel="canonical" href="'+pdpUrl+'"><meta property="og:title" content="Test Shoes"><meta name="twitter:image" content="https://decathlon.com.sa/cdn/shoe.jpg"></head><body><main><span data-sku="SKU-ABC"></span><form action="/cart/add"><input name="id" value="12345"></form></main><script type="application/ld+json">'+JSON.stringify(schema)+'</script><script>wpmLoader({ initData: '+JSON.stringify(payload)+' });</script></body></html>';
}
const body=(v={})=>JSON.stringify({handle:"test-shoes",title:"Test Shoes",variants:[{id:12345,sku:"SKU-ABC",price:4900,available:true,...v}]});
const check=(v={})=>compareDecathlonAjaxProductWithPdp({pdpHtml:html(),pdpUrl,ajaxBody:body(v)});
const failClosed=r=>{
  for(const key of ["inventoryVerified","shippingVerified","shippingFeeVerified","deliveryDestinationVerified","checkoutVerified","quoteAllowed","trustedOfferEligible","customerVisible","sourceFreshnessCertified"])
    assert.equal(r[key],false,key);
  for(const privateValue of ["SKU-ABC","12345","test-shoes","49.00","https://"])
    assert.equal(JSON.stringify(r).includes(privateValue),false,privateValue);
};
test("source-owned HTTPS Ajax endpoint only",()=>{
  assert.equal(deriveDecathlonAjaxUrl(pdpUrl),ajaxUrl);
  for(const x of [base+"/products/test-shoes?variant=12345","https://evil.example/products/test-shoes","http://decathlon.com.sa/products/test-shoes",base+"/cart",base+"/products/test-shoes.js"])
    assert.equal(deriveDecathlonAjaxUrl(x),null);
});
test("robots allow/disallow, specificity and agent overrides",()=>{
  assert.equal(evaluateDecathlonRobotsPolicy(robots,ajaxUrl).permitted,true);
  assert.equal(evaluateDecathlonRobotsPolicy("User-agent: *\nDisallow: /products/\nAllow: /products/test-shoes.js\n",ajaxUrl).permitted,true);
  assert.equal(evaluateDecathlonRobotsPolicy("User-agent: *\nAllow: /\nDisallow: /products/*.js$\n",ajaxUrl).status,"ROBOTS_DISALLOW");
  assert.equal(evaluateDecathlonRobotsPolicy("User-agent: *\nAllow: /\nUser-agent: NawaaSourceAudit\nDisallow: /products/\n",ajaxUrl).permitted,false);
});
test("robots unavailable, denied or foreign URL fail closed",()=>{
  for(const x of ["","garbage","User-agent: *\nDisallow: /\n","User-agent: OtherBot\nAllow: /\n"])
    assert.equal(evaluateDecathlonRobotsPolicy(x,ajaxUrl).permitted,false);
  assert.equal(evaluateDecathlonRobotsPolicy(robots,"https://evil.example/products/test-shoes.js").permitted,false);
});
test("exact matching variant price in Ajax is only presentment-currency signal",()=>{
  const r=check();
  assert.equal(r.status,"AJAX_VARIANT_AVAILABLE_SIGNAL");
  assert.equal(r.productOwned,true);
  assert.equal(r.selectedVariantMatched,true);
  assert.equal(r.variantPriceCentsMatched,true);
  assert.equal(r.merchantAvailableSignal,true);
  assert.equal(r.ajaxPresentmentCurrencyVerified,false);
  failClosed(r);
});
test("variant boolean false differs from available, never certifies physical stock",()=>{
  const r=check({available:false});
  assert.equal(r.status,"AJAX_VARIANT_UNAVAILABLE_SIGNAL");
  assert.equal(r.merchantAvailableSignal,false);
  failClosed(r);
});
test("other SKU, selected variant, family handle and duplicates all blocked",()=>{
  for(const x of [{sku:"OTHER"},{id:9876}]){
    const r=check(x);assert.equal(r.variantPriceCentsMatched,false);failClosed(r);
  }
  const duplicate=compareDecathlonAjaxProductWithPdp({pdpHtml:html(),pdpUrl,
    ajaxBody:JSON.stringify({handle:"test-shoes",title:"Test Shoes",variants:[
      {id:12345,sku:"SKU-ABC",price:4900,available:true},
      {id:12345,sku:"SKU-ABC",price:4900,available:false},
    ]})});
  assert.equal(duplicate.status,"AJAX_SELECTED_VARIANT_AMBIGUOUS");failClosed(duplicate);
  const other=compareDecathlonAjaxProductWithPdp({pdpHtml:html(),pdpUrl,
    ajaxBody:JSON.stringify({handle:"other",title:"Test Shoes",variants:[{id:12345,sku:"SKU-ABC",price:4900,available:true}]})});
  assert.equal(other.status,"AJAX_PRODUCT_IDENTITY_CONFLICT");failClosed(other);
});
test("misleading or invalid cents never certifies source pricing",()=>{
  for(const value of [49,4901,0,-1,49.1,"4900",null]){
    const r=check({price:value});assert.equal(r.variantPriceCentsMatched,false);failClosed(r);
  }
});
test("missing availability, non-JSON and too many variants never promote",()=>{
  const r=compareDecathlonAjaxProductWithPdp({pdpHtml:html(),pdpUrl,
    ajaxBody:JSON.stringify({handle:"test-shoes",title:"Test Shoes",variants:[{id:12345,sku:"SKU-ABC",price:4900}]})});
  assert.equal(r.status,"AJAX_VARIANT_AVAILABILITY_UNKNOWN");failClosed(r);
  const bad=compareDecathlonAjaxProductWithPdp({pdpHtml:html(),pdpUrl,ajaxBody:"<html/>"});
  assert.equal(bad.status,"AJAX_BODY_INVALID");failClosed(bad);
  const tooMany=compareDecathlonAjaxProductWithPdp({pdpHtml:html(),pdpUrl,
    ajaxBody:JSON.stringify({handle:"test-shoes",title:"Test Shoes",variants:Array.from({length:251},(_,i)=>({id:i,sku:"X",price:500}))})});
  assert.equal(tooMany.status,"AJAX_PRODUCT_INVALID");failClosed(tooMany);
});
