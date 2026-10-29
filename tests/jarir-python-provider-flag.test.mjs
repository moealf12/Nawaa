import test from "node:test";
import assert from "node:assert/strict";
import {searchJarir} from "../server/providers/jarir.mjs";

const URL="https://www.jarir.com/sa-en/apple-iphone-17-smartphones-666784.html";
const constructorPayload={
  response:{results:[{
    value:"Apple iPhone 17 256GB Black",
    data:{id:"666784",url:"apple-iphone-17-smartphones-666784.html",
      price:4399,image_url:"https://www.jarir.com/iphone.jpg",
      metadata:{name:"Apple iPhone 17 256GB Black",brand:"Apple"}}
  }]}
};
const liveEvidence=()=>({
  price:"4299.00",currency:"SAR",availability:"IN_STOCK",
  sku:"666784",product_title:"Apple iPhone 17 256GB Black",
  seller:"Jarir Bookstore",offer_url:URL,requested_url:URL,final_url:URL,
  response_sha256:"d".repeat(64),fetched_at:new Date().toISOString(),issues:[],
  field_evidence:Object.fromEntries(
    ["price","currency","availability_raw","seller","offer_url"].map(k=>[k,{source:"JSON-LD"}]))
});

test("opt-in provider emits one same-SKU enriched Jarir offer, never two price versions",async t=>{
  const prevFetch=globalThis.fetch,prevFlag=process.env.NAWAA_JARIR_PYTHON_PDP;
  t.after(()=>{
    globalThis.fetch=prevFetch;
    if(prevFlag===undefined)delete process.env.NAWAA_JARIR_PYTHON_PDP;
    else process.env.NAWAA_JARIR_PYTHON_PDP=prevFlag;
  });
  process.env.NAWAA_JARIR_PYTHON_PDP="1";
  const requested=[],published=[];
  globalThis.fetch=async url=>{
    requested.push(String(url));
    return Response.json(constructorPayload);
  };
  const result=await searchJarir("iPhone 17 256GB",3,"iPhone 17 256GB",{
    pythonExtract:async args=>{
      assert.equal(args.expectedSku,"666784");
      assert.equal(args.url,URL);
      return liveEvidence();
    },
    onOffers:async offers=>published.push(offers)
  });
  assert.equal(requested.length,1,"only existing constructor source fetch; Python transport injected");
  assert.equal(result.offers.length,1);
  assert.equal(published.length,1,"one final SSE event, not initial + enriched price events");
  assert.equal(published[0].length,1);
  assert.equal(published[0][0].productPrice,4299);
  assert.equal(result.offers[0].productPrice,4299);
  assert.equal(result.offers[0].sourceMeta.productId,"666784");
  assert.equal(result.diagnostics.pythonJarirPdp.attempted,1);
  assert.equal(result.diagnostics.pythonJarirPdp.accepted,1);
  assert.equal(result.offers[0].priceConfidence,"incomplete");
});

test("feature disabled: injected extractor is never called; existing price retained",async t=>{
  const prevFetch=globalThis.fetch,prevFlag=process.env.NAWAA_JARIR_PYTHON_PDP;
  t.after(()=>{
    globalThis.fetch=prevFetch;
    if(prevFlag===undefined)delete process.env.NAWAA_JARIR_PYTHON_PDP;
    else process.env.NAWAA_JARIR_PYTHON_PDP=prevFlag;
  });
  delete process.env.NAWAA_JARIR_PYTHON_PDP;
  globalThis.fetch=async()=>Response.json(constructorPayload);
  const result=await searchJarir("iPhone 17 256GB",3,"iPhone 17 256GB",{
    pythonExtract:async()=>{throw Error("disabled must not spawn Python");}
  });
  assert.equal(result.offers.length,1);
  assert.equal(result.offers[0].productPrice,4399);
  assert.equal(result.diagnostics.pythonJarirPdp,undefined);
});
