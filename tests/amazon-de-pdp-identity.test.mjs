import assert from "node:assert/strict";
import test from "node:test";
import {inspectAmazonDePdpHtml} from "../src/amazon-de-pdp-identity.mjs";
const url="https://www.amazon.de/dp/B0FQFW3423";
test("A live-observed generic Amazon DE HTML 200 cannot attest a requested ASIN",()=>{
  const report=inspectAmazonDePdpHtml("<html><head><title>Amazon.de</title></head></html>",url);
  assert.equal(report.status,"PDP_ASIN_NOT_OBSERVED");
  assert.equal(report.expectedAsin,"B0FQFW3423");
  assert.equal(report.priceVerified,false);
  assert.equal(report.requestedProductIdentityAttested,false);
});
test("Even an ASIN marker does not certify price or requested variant",()=>{
  const report=inspectAmazonDePdpHtml('<span data-asin="B0FQFW3423">Other products</span>',url);
  assert.equal(report.status,"ASIN_MARKER_PRESENT_UNATTESTED");
  assert.equal(report.priceVerified,false);
  assert.equal(report.requestedProductIdentityAttested,false);
});
test("Amazon DE URL guard refuses foreign hosts and malformed URLs",()=>{
  assert.equal(inspectAmazonDePdpHtml("", "https://www.amazon.de.evil.example/dp/B0FQFW3423"),null);
  assert.equal(inspectAmazonDePdpHtml("", "https://evil@www.amazon.de/dp/B0FQFW3423"),null);
  assert.equal(inspectAmazonDePdpHtml("", "http://www.amazon.de/dp/B0FQFW3423"),null);
  assert.equal(inspectAmazonDePdpHtml("", "https://www.amazon.de/s?k=watch"),null);
  assert.equal(inspectAmazonDePdpHtml("", "https://www.thomann.de/de/watch.htm"),null);
});


import {extractAmazonDeScopedOffer} from "../src/amazon-de-pdp-identity.mjs";
import {extractionCandidates} from "../server/url-resolver.mjs";

const subjectAsin="B0FQFW3423",foreignAsin="B0ABC12345";
function productNode(overrides={}) {
  return {"@context":"https://schema.org","@type":"Product",
    name:"Sample watch 46mm GPS",sku:subjectAsin,
    url:"https://www.amazon.de/dp/"+subjectAsin,
    image:"https://m.media-amazon.com/images/I/sample.jpg",
    offers:{"@type":"Offer",price:"299.99",priceCurrency:"EUR",
      url:"https://www.amazon.de/dp/"+subjectAsin,
      seller:{"@type":"Organization",name:"Declared sample seller"}},
    ...overrides};
}
const doc=(...nodes)=>'<html><head><title>Amazon.de</title>'+
  '<meta property="product:price:amount" content="1.00">'+
  '<meta property="product:price:currency" content="EUR"></head>'+
  '<body><span data-asin="'+subjectAsin+'">cross-sell</span>'+
  '<script type="application/ld+json">'+JSON.stringify({"@graph":nodes})+
  '</script></body></html>';

test("Exact Amazon DE JSON-LD Product+Offer binds source-declared EUR price and seller",()=>{
  const html=doc(productNode());
  const result=extractAmazonDeScopedOffer(html,url);
  assert.equal(result.status,"SOURCE_DECLARED_SAME_ASIN_OFFER_NOT_ATTESTED");
  assert.equal(result.expectedAsin,subjectAsin);
  assert.equal(result.product.sku,subjectAsin);
  assert.equal(result.product.offers.price,299.99);
  assert.equal(result.product.offers.priceCurrency,"EUR");
  assert.equal(result.product.sourceDeclaredSeller,"Declared sample seller");
  assert.equal(result.buyerVisiblePriceParity,false);
  assert.equal(result.sellerIndependentlyVerified,false);
  assert.equal(result.saudiCheckoutVerified,false);
  const candidates=extractionCandidates(html,url);
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].adapterId,"amazon-de-same-asin");
  assert.equal(candidates[0].product.offers.price,299.99);
});

test("Amazon DE plain ASIN in a recommendation cannot grant a price",()=>{
  const result=extractAmazonDeScopedOffer(doc(productNode({
    sku:foreignAsin,url:"https://www.amazon.de/dp/"+foreignAsin,
  })),url);
  assert.equal(result.status,"UNAMBIGUOUS_ASIN_PRODUCT_NOT_FOUND");
  assert.deepEqual(extractionCandidates(doc(productNode({
    sku:foreignAsin,url:"https://www.amazon.de/dp/"+foreignAsin,
  })),url),[]);
});
test("Any ambiguity about the same ASIN, offer, currency, seller or price fails closed",()=>{
  const change=(field,value)=>productNode({offers:{...productNode().offers,[field]:value}});
  const variants=[
    productNode({sku:foreignAsin}),
    productNode({productID:foreignAsin}),
    change("url","https://www.amazon.de/dp/"+foreignAsin),
    change("url","https://www.amazon.de.evil.example/dp/"+subjectAsin),
    change("priceCurrency","USD"),
    change("price","299,99"),
    change("price",-1),
    change("seller",null),
    change("priceSpecification",{"price":"1.00","priceCurrency":"EUR"}),
    productNode({offers:[productNode().offers,productNode().offers]}),
    productNode({offers:{"@type":"AggregateOffer",lowPrice:"2.00",priceCurrency:"EUR"}}),
    productNode({name:"X"}),
  ];
  for(const node of variants){
    const scoped=extractAmazonDeScopedOffer(doc(node),url);
    assert.equal(scoped.product,null,JSON.stringify(node).slice(0,180));
    assert.deepEqual(extractionCandidates(doc(node),url),[]);
  }
  const duplicate=extractAmazonDeScopedOffer(doc(productNode(),productNode({
    offers:{...productNode().offers,price:"4.00"}
  })),url);
  assert.equal(duplicate.product,null);
});
test("Reject cross-selling structure even when generic meta tags contain prices",()=>{
  const html=doc(productNode({url:"https://www.amazon.de/dp/"+foreignAsin}),
    {"@type":"Product",name:"recommendation",url:"https://www.amazon.de/dp/"+foreignAsin,
      offers:{"@type":"Offer",price:"4.00",priceCurrency:"EUR"}});
  assert.deepEqual(extractionCandidates(html,url),[]);
  assert.equal(extractAmazonDeScopedOffer(html,url).product,null);
});
test("Scoped Amazon DE offer path never alters other merchants",()=>{
  const html=doc(productNode());
  assert.equal(extractAmazonDeScopedOffer(html,"https://www.amazon.co.uk/dp/"+subjectAsin),null);
  assert.equal(extractAmazonDeScopedOffer(html,"https://amazon.de.evil.example/dp/"+subjectAsin),null);
  assert.equal(extractAmazonDeScopedOffer(html,"https://www.amazon.de/s?k=watch"),null);
});
