import test from "node:test";
import assert from "node:assert/strict";
import {certifyModelTitleMatch,assessCertificationModelExamples} from "../server/tooling/source-model-evidence.mjs";

test("AirPods cannot be certified by all-EarPods result titles",()=>{
 const query="airpods";
 const titles=[
  "Apple EarPods Wired In-Ear Headphones (Lightning)",
  "Apple EarPods Wired In-Ear Headphones (3.5mm Jack)"
 ];
 assert.equal(titles.every(title=>!certifyModelTitleMatch(query,title).matches),true);
 const audit=assessCertificationModelExamples({query,validCount:2,examples:titles.map(title=>({title}))});
 assert.equal(audit.status,"exhaustive_sample_model_mismatch");
 assert.equal(audit.matchingExamples,0);
});
test("matching actual model title is an eligible query-positive (not a SKU or price proof)",()=>{
 assert.equal(certifyModelTitleMatch("airpods","Apple AirPods 5 Bluetooth Earbuds").matches,true);
 assert.equal(certifyModelTitleMatch("iphone 17","Apple iPhone 17 256GB").matches,true);
 assert.equal(certifyModelTitleMatch("galaxy s25","Samsung Galaxy S25 Ultra").matches,true);
 assert.equal(certifyModelTitleMatch("playstation 5","Sony PlayStation PS5 Slim Console").matches,true);
 assert.equal(certifyModelTitleMatch("ps5","PS5 Digital Edition Console").matches,true);
});
test("model/version switches and generic EarPods fail for precise searches",()=>{
 assert.equal(certifyModelTitleMatch("iphone 17","iPhone 16 Pro").matches,false);
 assert.equal(certifyModelTitleMatch("galaxy s25","Samsung Galaxy S26 Ultra").matches,false);
 assert.equal(certifyModelTitleMatch("playstation 5","PS4 console").matches,false);
 assert.equal(certifyModelTitleMatch("airpods","Apple EarPods headphones").matches,false);
});
test("generic category searches retain existing structural rules",()=>{
 assert.deepEqual(certifyModelTitleMatch("chair","IKEA dining chair"),
  {restricted:false,model:null,matches:true});
 assert.deepEqual(certifyModelTitleMatch("television","Samsung smart TV"),
  {restricted:false,model:null,matches:true});
});
test("invalid or missing title cannot prove model match",()=>{
 assert.equal(certifyModelTitleMatch("airpods",null).matches,false);
 assert.equal(certifyModelTitleMatch("airpods",{}).matches,false);
});
