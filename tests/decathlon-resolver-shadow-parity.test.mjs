import test, {mock} from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import {extractProductDocument} from "../server/url-resolver.mjs";

const url="https://decathlon.com.sa/products/test-running-shoe";
function fixture(){
  const product={"@context":"https://schema.org","@type":"Product",
    name:"Test Running Shoe",url};
  const data={productVariants:[{
    id:"12345",sku:"SHOE-10",title:"Default Title",
    price:{amount:"99.00",currencyCode:"SAR"},
    product:{url:"/products/test-running-shoe",title:"Test Running Shoe"},
  }]};
  return '<html><head><link rel="canonical" href="'+url+'">'+
    '<meta property="og:title" content="Test Running Shoe">'+
    '<meta name="twitter:image" content="https://decathlon.com.sa/cdn/shoe.jpg">'+
    '<meta property="product:price:amount" content="99.00">'+
    '<meta property="product:price:currency" content="SAR"></head>'+
    '<body><main><div data-sku="SHOE-10"></div>'+
    '<form action="/cart/add"><input name="id" value="12345"></form></main>'+
    '<script type="application/ld+json">'+JSON.stringify(product)+'</script>'+
    '<script>wpmLoader({ initData: '+JSON.stringify(data)+' });</script></body></html>';
}
test("real extractProductDocument obtains identical product candidates OFF vs ON with one GET each", {concurrency:false},async()=>{
  const oldTransport=process.env.NAWAA_TEST_TRANSPORT;
  const oldFlag=process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
  const oldFetch=globalThis.fetch;
  const fakeDns=mock.method(dns,"lookup",async()=>[{address:"8.8.8.8",family:4}]);
  let requests=0,observations=[];
  globalThis.fetch=async()=>{
    requests++;
    return new Response(fixture(),{status:200,headers:{"content-type":"text/html"}});
  };
  process.env.NAWAA_TEST_TRANSPORT="fetch";
  try{
    delete process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
    const before=await extractProductDocument(url,{
      onDecathlonShadow:x=>observations.push(x),
    });
    assert.equal(requests,1);
    assert.equal(observations.length,0);
    process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW="1";
    const after=await extractProductDocument(url,{
      onDecathlonShadow:x=>observations.push(x),
    });
    assert.equal(requests,2,"ON does not add a second network request");
    assert.deepEqual(after,before,"source candidates and diagnostics are bit-for-bit unchanged");
    assert.equal(observations.length,1);
    assert.equal(observations[0].variantPriceOwned,true);
    assert.equal(observations[0].trustedOfferEligible,false);
    assert.equal(observations[0].sourceFreshnessCertified,false);
    assert.equal(JSON.stringify(observations[0]).includes("99.00"),false);
    assert.equal(JSON.stringify(after).includes("variantPriceOwned"),false);
  }finally{
    fakeDns.mock.restore();
    globalThis.fetch=oldFetch;
    if(oldTransport===undefined)delete process.env.NAWAA_TEST_TRANSPORT;
    else process.env.NAWAA_TEST_TRANSPORT=oldTransport;
    if(oldFlag===undefined)delete process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW;
    else process.env.NAWAA_DECATHLON_PRICE_EVIDENCE_SHADOW=oldFlag;
  }
});
