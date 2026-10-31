import test from "node:test";
import assert from "node:assert/strict";
import {provisionalLabel,judgedMetrics} from "../scripts/verify-r04-live-ranking.mjs";
const p=(kind,title,more={})=>provisionalLabel(kind,{title,...more});
test("R04 live rubric: no ranking-score/price leakage into external identity labels",()=>{
 const a={title:"Apple iPhone 17 256GB",matchConfidence:0,exactMatch:false,productPrice:5000};
 const b={...a,matchConfidence:1,exactMatch:true,productPrice:1};
 assert.deepEqual(provisionalLabel("iphone",a),{grade:3,reason:"iphone17_256_explicit"});
 assert.deepEqual(provisionalLabel("iphone",a),provisionalLabel("iphone",b));
 assert.equal(p("iphone","iPhone 17 Pro 256GB").grade,2);
 assert.equal(p("iphone","Case for iPhone 17 256GB").grade,0);
 assert.equal(p("iphone","Unknown mobile accessory model").grade,null);
});
test("R04 live rubric: consoles, variants, peripherals and missing specifications",()=>{
 assert.equal(p("ps5","Sony PlayStation 5 Digital Edition Console").grade,3);
 assert.equal(p("ps5","PS5 Disc Edition Console").grade,2);
 assert.equal(p("ps5","PS5 Disc Drive for Digital").grade,0);
 assert.equal(p("galaxy","Samsung Galaxy S25 Ultra 256GB").grade,3);
 assert.equal(p("galaxy","Samsung Galaxy S25 Plus 256GB").grade,2);
 assert.equal(p("galaxy","Samsung device").grade,null);
});
test("R04 live rubric: explicit positive evidence only for audio and computing",()=>{
 assert.equal(p("jbl","JBL Bluetooth Headphones").grade,3);
 assert.equal(p("jbl","JBL wired headphones").grade,2);
 assert.equal(p("jbl","JBL Bluetooth Speaker").grade,2);
 assert.equal(p("laptop","HP Pavilion Laptop 16GB RAM").grade,3);
 assert.equal(p("laptop","HP Pavilion Laptop 8GB RAM").grade,2);
 assert.equal(p("laptop","HP Pavilion laptop sleeve").grade,0);
 assert.equal(p("laptop","MacBook Pro 16GB RAM").grade,null);
});
test("R04 metrics: unknown relevance is never auto-converted into zero",()=>{
 const unknown=judgedMetrics([
  {judgment:{grade:3}},{judgment:{grade:null}},{judgment:{grade:0}}
 ]);
 assert.equal(unknown.ndcg10,null);assert.equal(unknown.mrr10,null);
 assert.equal(unknown.unjudged,1);
 const complete=judgedMetrics([{judgment:{grade:0}},{judgment:{grade:3}}]);
 assert.equal(complete.mrr10,.5);
 assert.ok(complete.ndcg10<1);
 assert.equal(complete.metricStatus,"PROVISIONAL_RULE_LABELS");
});
