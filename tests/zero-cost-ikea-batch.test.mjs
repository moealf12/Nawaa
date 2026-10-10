import test from "node:test";
import assert from "node:assert/strict";
import {PILOT_PRODUCTS,runIkeaReadOnlyBatch,headCheckIkeaImage} from "../scripts/probe-ikea-batch.mjs";
const product=PILOT_PRODUCTS[0];
const extract=async()=>({finalUrl:product.url,candidates:[{strategy:"jsonld",product:{
 name:"POANG armchair birch veneer",sku:"392.407.87",image:"https://www.ikea.com/sa/en/images/products/example.jpg",
 offers:{price:479,priceCurrency:"SAR",url:product.url}}}]});
test("bounded IKEA batch measures product/image quality without recording offers",async()=>{
 const result=await runIkeaReadOnlyBatch({products:[product],
  extract,probeImage:async()=>({reachable:true,status:200}),delayMs:0});
 assert.equal(result.passed,true);
 assert.equal(result.metrics.extracted,1);
 assert.equal(result.metrics.reachableImages,1);
 assert.equal(result.items[0].price,479);
});
test("partial failures remain inspectable and low coverage fails admission gate",async()=>{
 const result=await runIkeaReadOnlyBatch({products:[product,
 {sku:"bad",category:"tables",url:"https://bad.example/"}],
 extract,probeImage:async()=>({reachable:false,reason:"cdn_blocked"}),delayMs:0});
 assert.equal(result.passed,false);
 assert.equal(result.metrics.extracted,1);
 assert.equal(result.metrics.failures,1);
 assert.equal(result.items[0].imageReachable,false);
});
test("an unapproved image host is not contacted",async()=>{
 const result=await headCheckIkeaImage("https://127.0.0.1/private");
 assert.equal(result.reachable,false);
 assert.equal(result.reason,"unapproved_image_host");
});

test("rejects volatile price seen in consecutive readings of same merchant page",async()=>{
 let count=0;
 const volatile=async()=>{
  const page=await extract();
  page.candidates[0].product.offers.price=++count===1?479:399;
  return page;
 };
 const result=await runIkeaReadOnlyBatch({products:[product],extract:volatile,
  probeImage:async()=>({reachable:true,status:200}),delayMs:0});
 assert.equal(result.passed,false);
 assert.equal(result.metrics.failures,1);
 assert.equal(result.items[0].error,"repeated_merchant_observation_disagreed");
});

test("IKEA image URLs returning an invalid response do not pass qualification",async()=>{
 const result=await runIkeaReadOnlyBatch({products:[product],extract,
  probeImage:async()=>({reachable:false,status:404,reason:"unexpected_image_response"}),delayMs:0});
 assert.equal(result.metrics.extracted,1);
 assert.equal(result.metrics.images,1);
 assert.equal(result.metrics.reachableImages,0);
 assert.equal(result.passed,false);
});
