import test from "node:test";
import assert from "node:assert/strict";
import {AMAZON_DE_PUBLICATION_HOLD,amazonDeCustomerPriceDecision,
  compareAmazonDeDeclaredVsBuybox} from "../src/amazon-de-price-gate.mjs";
import {searchFreeStorefrontById} from "../server/providers/free-storefronts.mjs";
import {extractAmazonDeScopedOffer} from "../src/amazon-de-pdp-identity.mjs";
import {extractionCandidates} from "../server/url-resolver.mjs";

const asin="B0FQFW3423";
const url="https://www.amazon.de/dp/"+asin;
const sourceNode={
  "@type":"Product",name:"Sample watch 46mm GPS",sku:asin,url,
  image:"https://m.media-amazon.com/images/I/sample.jpg",
  offers:{"@type":"Offer",price:"299.99",priceCurrency:"EUR",url,
    seller:{"@type":"Organization",name:"Sample seller"}},
};
const doc='<html><head><title>Sample watch</title></head><body>'+
  '<div data-asin="'+asin+'"></div><script type="application/ld+json">'+
  JSON.stringify(sourceNode)+'</script></body></html>';
test("No untrusted flags can enable German Amazon price publication",()=>{
  const decision=amazonDeCustomerPriceDecision({
    sourceId:"amazon-de",sourceUrl:url,buyerVisiblePriceParity:true,
    merchantAttested:true,trustBadge:true,canShipToSaudi:true,
  });
  assert.deepEqual(decision,{customerPublishable:false,status:AMAZON_DE_PUBLICATION_HOLD});
  assert.equal(amazonDeCustomerPriceDecision({sourceUrl:url}).customerPublishable,false);
  assert.equal(amazonDeCustomerPriceDecision({sourceUrl:"https://amazon.de/gp/product/"+asin}).customerPublishable,false);
  assert.equal(amazonDeCustomerPriceDecision({sourceUrl:"https://amazon.de.evil.example/dp/"+asin}).customerPublishable,true);
  assert.equal(amazonDeCustomerPriceDecision({sourceId:"amazon-uk"}).customerPublishable,true);
});
test("Synthetic same-ASIN, same seller and cents match still cannot certify retail price",()=>{
  const offer=extractAmazonDeScopedOffer(doc,url).product;
  assert.equal(extractionCandidates(doc,url)[0].adapterId,"amazon-de-same-asin");
  const observation={asin,seller:"Sample seller",currency:"EUR",price:299.99};
  const result=compareAmazonDeDeclaredVsBuybox(offer,observation);
  assert.equal(result.structuralMatch,true);
  assert.equal(result.customerPublishable,false);
  assert.equal(result.buyboxIndependentlyAttested,false);
  for(const bad of [
    {...observation,asin:"B0ABC12345"},
    {...observation,seller:"Other seller"},
    {...observation,price:299.98},
    {...observation,currency:"SAR"},
    {...observation,price:0},
  ])assert.equal(compareAmazonDeDeclaredVsBuybox(offer,bad).structuralMatch,false);
});
test("Amazon Germany search results with a priced HTML card are diagnostic only, not shopper offers",
  {concurrency:false},async()=>{
  const original=globalThis.fetch;
  const card='<div data-asin="'+asin+'"><h2>Sample watch 46mm GPS</h2>'+
    '<span class="a-price"><span class="a-offscreen">299,99 €</span></span>'+
    '<a href="/dp/'+asin+'">Product</a></div>';
  const calls=[];
  try{
    globalThis.fetch=async request=>{
      calls.push(String(request));
      return new Response('<html>'+card+'</html>',{
        status:200,headers:{"content-type":"text/html"},
      });
    };
    const result=await searchFreeStorefrontById("amazon-de","watch",{perStore:2});
    assert.equal(calls.length,1,"must not request PDP as backdoor");
    assert.ok(calls[0].startsWith("https://www.amazon.de/s?"));
    assert.equal(result.candidates,1);
    assert.deepEqual(result.offers,[]);
    assert.deepEqual(result.diagnostics.customerPublicationGate,{
      status:AMAZON_DE_PUBLICATION_HOLD,customerPublishable:false,
      withheldSearchCandidates:1,withheldResolvedOffers:0,
      sourcePriceVerified:false,buyerVisibleBuyboxVerified:false,
      shippingToSaudiVerified:false,
    });
    assert.equal(JSON.stringify(result.offers).includes("299.99"),false);
  }finally{globalThis.fetch=original}
});
