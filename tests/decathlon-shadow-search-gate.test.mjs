import test from "node:test";
import assert from "node:assert/strict";
import {inspectFetchedDecathlonDocumentShadow} from "../server/url-resolver.mjs";
import {
  isDecathlonShadowEnabled,
  observeDecathlonSearchEvidence,
} from "../server/decathlon-shadow-gate.mjs";

const url="https://decathlon.com.sa/products/kalenji-shoes";
function html({sku="KAL-10",variant="12345",price="99.00",currency="SAR",
  recordSku=sku,recordVariant=variant,recordTitle="Kalenji Shoes",
  image="https://decathlon.com.sa/cdn/shoes.jpg"}={}){
  const product={"@context":"https://schema.org","@type":"Product",name:"Kalenji Shoes",url};
  const variantData={productVariants:[{id:recordVariant,sku:recordSku,
    price:{amount:price,currencyCode:currency},image:{src:image},
    product:{url:"/products/kalenji-shoes",title:recordTitle},title:"Default Title"}]};
  return '<html><head><link rel="canonical" href="'+url+'">'+
    '<meta property="og:title" content="Kalenji Shoes"><meta name="twitter:image" content="'+image+'">'+
    '</head><body><main><div data-sku="'+sku+'"></div><form action="/cart/add">'+
    '<input name="id" value="'+variant+'"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(product)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify(variantData)+' });</script></body></html>';
}

test("v22.02 OFF by default; only literal 1 enables; callback is never invoked while OFF",()=>{
  assert.equal(isDecathlonShadowEnabled(undefined),false);
  assert.equal(isDecathlonShadowEnabled("true"),false);
  assert.equal(isDecathlonShadowEnabled("0"),false);
  assert.equal(isDecathlonShadowEnabled("1"),true);
  let calls=0;
  const out=observeDecathlonSearchEvidence({
    enabled:false,requestedUrl:url,finalUrl:url,html:html(),
    fetchedAtMs:1000,nowMs:1000,onObservation:()=>{calls++;}
  });
  assert.equal(out,null);
  assert.equal(calls,0);
});

test("v22.02 ON: same HTML yields private, non-promotable price-owner evidence",()=>{
  let observed;
  const out=observeDecathlonSearchEvidence({
    enabled:true,requestedUrl:url,finalUrl:url,html:html(),
    fetchedAtMs:1000,nowMs:1002,onObservation:x=>{observed=x;}
  });
  assert.deepEqual(out,observed);
  assert.equal(out.status,"EXPLICIT_VARIANT_SKU_PRICE_OWNERSHIP");
  assert.equal(out.variantPriceOwned,true);
  assert.equal(out.sourceFreshnessCertified,false);
  assert.equal(out.inventoryVerified,false);
  assert.equal(out.shippingVerified,false);
  assert.equal(out.trustedOfferEligible,false);
  assert.equal(out.customerVisible,false);
  for(const secret of ["99.00","KAL-10","12345","kalenji-shoes","https://"]){
    assert.equal(JSON.stringify(out).includes(secret),false,secret);
  }
});

test("v22.02 failing cross-SKU/variant or currency cannot promote source price",()=>{
  for(const options of [
    {recordSku:"wrong"},{recordVariant:"77777"},{currency:"USD"},{price:"0"},
  ]){
    const result=observeDecathlonSearchEvidence({
      enabled:true,requestedUrl:url,finalUrl:url,html:html(options),
      fetchedAtMs:1000,nowMs:1000,
    });
    assert.equal(result.variantPriceOwned,false);
    assert.equal(result.trustedOfferEligible,false);
    assert.equal(result.customerVisible,false);
  }
});

test("v22.02 strict same-host same-path policy blocks redirects and different stores",()=>{
  let called=0;
  for(const badUrl of [
    "https://decathlon.com.sa/products/other",
    "https://evil.example/products/kalenji-shoes",
    "http://decathlon.com.sa/products/kalenji-shoes",
    url+"?variant=99999",
  ]){
    const out=observeDecathlonSearchEvidence({
      enabled:true,requestedUrl:url,finalUrl:badUrl,html:html(),
      fetchedAtMs:1000,nowMs:1000,onObservation:()=>called++,
    });
    assert.equal(out,null);
  }
  assert.equal(called,0);
});

test("v22.02 source freshness is never certified; old/future acquisition timestamps fail closed",()=>{
  for(const opts of [{fetchedAtMs:1000,nowMs:1000+20_000},
    {fetchedAtMs:2000,nowMs:1000},
    {fetchedAtMs:null,nowMs:1000}]){
    const out=observeDecathlonSearchEvidence({
      enabled:true,requestedUrl:url,finalUrl:url,html:html(),...opts,
    });
    assert.equal(out.status,"OBSERVATION_TIME_INVALID");
    assert.equal(out.variantPriceOwned,false);
    assert.equal(out.trustedOfferEligible,false);
  }
});

test("v22.02 empty HTML and thrown callback never break primary search",()=>{
  const empty=observeDecathlonSearchEvidence({
    enabled:true,requestedUrl:url,finalUrl:url,html:"",
    fetchedAtMs:1000,nowMs:1000,
  });
  assert.equal(empty.variantPriceOwned,false);
  assert.doesNotThrow(()=>observeDecathlonSearchEvidence({
    enabled:true,requestedUrl:url,finalUrl:url,html:html(),
    fetchedAtMs:1000,nowMs:1000,onObservation:()=>{throw Error("receiver failed");},
  }));
});

test("v22.02 feature shadow cannot change price fields/offer count in existing resolver candidates",async()=>{
  // This verifies a side-channel read-only contract: the observer must not
  // mutate markup or previously resolved offers.
  const page=html();
  const existing=Object.freeze({offers:[Object.freeze({price:50,currency:"SAR"})]});
  const before=JSON.stringify(existing);
  observeDecathlonSearchEvidence({
    enabled:true,requestedUrl:url,finalUrl:url,html:page,
    fetchedAtMs:1000,nowMs:1000,
  });
  assert.equal(JSON.stringify(existing),before);
});


test("resolver integration: OFF never emits diagnostics; enabled consumes existing PDP HTML only", {concurrency:false},async()=>{
  const prev=process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
  const fetched={finalUrl:url,html:html()};
  let count=0,received=null;
  const options={fetchedAtMs:1000,nowMs:1000,onDecathlonShadow:x=>{count++;received=x;}};
  try{
    delete process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
    assert.equal(await inspectFetchedDecathlonDocumentShadow(fetched,url,options),undefined);
    assert.equal(count,0);
    process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW="1";
    assert.equal(await inspectFetchedDecathlonDocumentShadow(fetched,url,options),undefined);
    assert.equal(count,1);
    assert.equal(received.status,"EXPLICIT_VARIANT_SKU_PRICE_OWNERSHIP");
    assert.equal(received.trustedOfferEligible,false);
    assert.equal(received.sourceFreshnessCertified,false);
    // Source document is never changed or converted into a new offer.
    assert.equal(fetched.html,html());
    await inspectFetchedDecathlonDocumentShadow(fetched,
      "https://other.example/products/kalenji-shoes",options);
    assert.equal(count,1);
    await inspectFetchedDecathlonDocumentShadow({
      ...fetched,finalUrl:"https://decathlon.com.sa/products/other"},url,options);
    assert.equal(count,1);
  }finally{
    if(prev===undefined)delete process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
    else process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW=prev;
  }
});

test("resolver integration: throwing observability callback fails open for existing search but fails closed on promotion", {concurrency:false},async()=>{
  const prev=process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
  try{
    process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW="1";
    await assert.doesNotReject(()=>inspectFetchedDecathlonDocumentShadow(
      {finalUrl:url,html:html()},url,{
      fetchedAtMs:1000,nowMs:1000,onDecathlonShadow:()=>{throw Error("metrics receiver failed");}
    }));
  }finally{
    if(prev===undefined)delete process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
    else process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW=prev;
  }
});
