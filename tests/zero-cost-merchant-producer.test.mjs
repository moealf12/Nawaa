import test from "node:test";
import assert from "node:assert/strict";
import {extractCertifiedMerchantOffer,enqueueCertifiedMerchantProduct,LIVE_PRODUCER_SOURCES} from "../server/tooling/merchant-observation-producer.mjs";
import {createSignedSourceVerifier} from "../server/tooling/source-attestation.mjs";
import {createOfferIngestionHandler} from "../server/tooling/offer-ingestion-worker.mjs";
import {CERTIFIED_SOURCE_HOSTS} from "../src/certified-source-hosts.mjs";
const key="local-isolated-test-secret-minimum-thirty-two-bytes";
const url="https://www.ikea.com/sa/en/p/poang-test-chair-12345678/";
const image="https://www.ikea.com/image/test-chair.jpg";
const sample=()=>({finalUrl:url,candidates:[{strategy:"jsonld",product:{
 name:"POANG armchair",sku:"12345678",image,offers:{price:"399.00",priceCurrency:"SAR",url}
}}]});
const extraction=async()=>sample();
test("one live source only, with original product evidence and no implicit writes",async()=>{
 assert.deepEqual(Object.keys(LIVE_PRODUCER_SOURCES),["ikea-sa"]);
 const result=await extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,extract:extraction});
 assert.equal(result.offer.productPrice,399);
 assert.equal(result.offer.currency,"SAR");
 assert.equal(result.offer.imageUrl,image);
 assert.equal(result.evidence.hasImage,true);
 assert.equal(result.evidence.merchantPriceVerified,true);
});
test("pilot producer signs only observed merchant data; worker persists an authenticated minimal projection",async()=>{
 const sends=[];const boss={send:async (...args)=>{sends.push(args);return "job-id";}};
 const enqueued=await enqueueCertifiedMerchantProduct(boss,{sourceId:"ikea-sa",url,key,extract:extraction});
 assert.equal(enqueued.queued,true);
 assert.equal(sends.length,1);
 assert.match(sends[0][1].attestation,/^v1\./);
 let stored;
 const handler=createOfferIngestionHandler({
  verify:createSignedSourceVerifier({sourceHosts:CERTIFIED_SOURCE_HOSTS,key}),
  record:async data=>{stored=data;return {recorded:true,observationId:42};}
 });
 const outcome=await handler({data:{...sends[0][1],
  offer:{...sends[0][1].offer,observedAt:"2099-01-01",healthStatus:"healthy",
    totalSAR:1,brand:"Injected",condition:"used"},query:"injected-query"}});
 assert.equal(outcome.observationId,42);
 assert.equal(stored.productPrice,399);
 assert.equal(stored.query,"ikea-sa");
 assert.equal(stored.sourceName,"ikea-sa");
 for(const ignored of ["observedAt","healthStatus","totalSAR","brand","condition"])assert.equal(ignored in stored,false);
 await assert.rejects(handler({data:{...sends[0][1],
  offer:{...sends[0][1].offer,productPrice:1}}}),/trusted_source_verifier_required/);
});
test("reject unapproved sources and hostile product URLs before network I/O",async()=>{
 let fetches=0;const extractor=async()=>{fetches++;return sample();};
 const bad=[
  {sourceId:"amazon-sa",url},
  {sourceId:"ikea-sa",url:"https://ikea.com.evil.example/sa/en/p/fake"},
  {sourceId:"ikea-sa",url:"https://sub.ikea.com/sa/en/p/fake"},
  {sourceId:"ikea-sa",url:"https://www.ikea.com/sa/en/search?q=chair"},
  {sourceId:"ikea-sa",url:url+"?variant=bad"},
  {sourceId:"ikea-sa",url:"http://www.ikea.com/sa/en/p/fake"},
  {sourceId:"ikea-sa",url:"https://user:pass@www.ikea.com/sa/en/p/fake"}
 ];
 for(const args of bad)await assert.rejects(extractCertifiedMerchantOffer({...args,extract:extractor}));
 assert.equal(fetches,0);
});
test("reject redirected products, ambiguous variants, currency errors and uncertain prices",async()=>{
 const bad=[
  {...sample(),finalUrl:"https://www.ikea.com/sa/en/p/unrelated-4444"},
  {...sample(),finalUrl:"https://www.ikea.com.evil.example/sa/en/p/fake"},
  {...sample(),candidates:[]},
  {...sample(),candidates:[...sample().candidates,...sample().candidates]},
  {...sample(),candidates:[{strategy:"jsonld",product:{...sample().candidates[0].product,offers:[{price:199,priceCurrency:"SAR"}]}}]},
  {...sample(),candidates:[{strategy:"jsonld",product:{...sample().candidates[0].product,offers:{price:"39/month",priceCurrency:"SAR"}}}]},
  {...sample(),candidates:[{strategy:"jsonld",product:{...sample().candidates[0].product,offers:{price:399,priceCurrency:"USD"}}}]},
  {...sample(),candidates:[{strategy:"jsonld",product:{...sample().candidates[0].product,offers:{price:399,priceCurrency:"SAR",url:"https://www.ikea.com/sa/en/p/different"}}}]}
 ];
 for(const page of bad)await assert.rejects(extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,extract:async()=>page}));
});
test("image quality recorded as absent rather than approving unsafe image links",async()=>{
 const page=sample();page.candidates[0].product.image="http://internal.example/image.jpg";
 const r=await extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,extract:async()=>page});
 assert.equal(r.evidence.hasImage,false);
 assert.equal(r.offer.imageUrl,undefined);
});

test("matching merchant metadata supplies product-specific image without inventing a CDN link",async()=>{
 const page=sample();
 delete page.candidates[0].product.image;
 page.candidates.push({strategy:"meta",product:{
  name:"POANG armchair - IKEA",image:"https://www.ikea.com/product-meta.jpg",
  offers:{price:399,priceCurrency:"SAR"}
 }});
 // Metadata title is required to identify the SAME product; generic imagery is rejected.
 let r=await extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,extract:async()=>page});
 assert.equal(r.offer.imageUrl,"https://www.ikea.com/product-meta.jpg");
 assert.equal(r.evidence.imageSource,"matching_page_metadata");
 assert.equal(r.evidence.priceCrossCheck,"matched");
 page.candidates[1].product.name="Generic furniture catalog";
 r=await extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,extract:async()=>page});
 assert.equal(r.offer.imageUrl,undefined);
 assert.equal(r.evidence.priceCrossCheck,"unavailable");
});
test("disagreeing merchant metadata prices cannot be attested",async()=>{
 const page=sample();
 page.candidates.push({strategy:"meta",product:{
  name:"POANG armchair - IKEA",image:"https://www.ikea.com/alternate.jpg",
  offers:{price:1,priceCurrency:"SAR"}
 }});
 await assert.rejects(extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,
  extract:async()=>page}),/original_price_evidence_disagreement/);
});

test("merchant JSON-LD SKU must match product identifier embedded in official IKEA URL",async()=>{
 const changed=sample();changed.candidates[0].product.sku="999.999.99";
 await assert.rejects(extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,
  extract:async()=>changed}),/original_product_sku_mismatch/);
 const missing=sample();delete missing.candidates[0].product.sku;
 await assert.rejects(extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,
  extract:async()=>missing}),/original_product_sku_mismatch/);
});
test("unapproved third-party image URL is dropped, even if JSON-LD names it",async()=>{
 const fake=sample();fake.candidates[0].product.image="https://unrelated-cdn.example.invalid/a.jpg";
 const r=await extractCertifiedMerchantOffer({sourceId:"ikea-sa",url,extract:async()=>fake});
 assert.equal(r.offer.imageUrl,undefined);
 assert.equal(r.evidence.hasImage,false);
});
