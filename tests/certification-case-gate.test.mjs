import test from "node:test";
import assert from "node:assert/strict";
import {evaluateCertificationOfferCase} from "../server/tooling/certification-case-gate.mjs";
const mk=(title,price=99)=>({title,sourceUrl:"https://example.com/product",image:"https://example.com/photo.png",productPrice:price,currency:"SAR"});

test("real Virgin AirPods/EarPods example fails source certification despite structural validity",()=>{
 const offers=[
  mk("Apple EarPods Wired In-Ear Headphones (Lightning)",2.04),
  mk("Apple EarPods Wired In-Ear Headphones (3.5mm Jack)",2.04)
 ];
 const result=evaluateCertificationOfferCase("airpods",offers);
 assert.equal(result.valid.length,2);
 assert.equal(result.pass,false);
 assert.equal(result.modelMatchedCount,0);
 assert.equal(result.modelFailure,"QUERY_MODEL_MISMATCH");
});
test("one verified matching model title suffices among valid results",()=>{
 const result=evaluateCertificationOfferCase("airpods",[
  mk("Apple EarPods Wired In-Ear Headphones",2.04),
  mk("Apple AirPods 5 Wireless Bluetooth Earbuds",560.58)
 ]);
 assert.equal(result.valid.length,2);
 assert.equal(result.relevantValid.length,1);
 assert.equal(result.modelRejectedCount,1);
 assert.equal(result.pass,true);
});
test("obvious AirPods cases and iPhone protectors are not accepted as the device",()=>{
 for(const [query,title] of [
  ["airpods","Protective Case for Apple AirPods Pro"],
  ["airpods","Silicone Case for AirPods 5"],
  ["iphone 17","Apple iPhone 17 screen protector"],
  ["galaxy s25","Samsung Galaxy S25 clear case"]
 ]){
  const result=evaluateCertificationOfferCase(query,[mk(title)]);
  assert.equal(result.pass,false,title);
  assert.equal(result.modelFailure,"QUERY_MODEL_MISMATCH",title);
 }
});
test("real device with bundled charging case is still accepted",()=>{
 assert.equal(evaluateCertificationOfferCase("airpods",
  [mk("Apple AirPods 5 with Wireless Charging Case")]).pass,true);
 assert.equal(evaluateCertificationOfferCase("playstation 5",
  [mk("Sony PlayStation PS5 Slim Console")]).pass,true);
});
test("generic queries retain the existing structural checks",()=>{
 const result=evaluateCertificationOfferCase("chair",[mk("IKEA Dining Chair")]);
 assert.equal(result.pass,true);assert.equal(result.modelMatchRequired,false);
 assert.equal(evaluateCertificationOfferCase("chair",[mk("Invalid chair with no image")].map(x=>({...x,image:null}))).pass,false);
});
test("negative probe must return zero offers regardless of other fields",()=>{
 const negative="nawaa-unfindable-943271-20261003";
 assert.equal(evaluateCertificationOfferCase(negative,[]).pass,true);
 assert.equal(evaluateCertificationOfferCase(negative,[mk("some item")]).pass,false);
});
