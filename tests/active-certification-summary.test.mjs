import test from "node:test";
import assert from "node:assert/strict";
import {summarizeCertification} from "../scripts/summarize-active-certification.mjs";

function certified(id){
  return {
    source:id,passed:true,routeCoverage:[{query:"iphone 17",routed:true}],
    cases:[
      {query:"iphone 17",pass:true,validCount:2},
      {query:"airpods",pass:true,validCount:1},
      {query:"nawaa-unfindable-943271-20261003",pass:true,validCount:0},
    ],
  };
}

test("39-source rollup certifies only complete evidence sets",()=>{
  const ids=["a","b"];
  const report=summarizeCertification(ids,new Map(ids.map(id=>[id,certified(id)])));
  assert.deepEqual(report.stats,{expected:2,certified:2,failed:0,missing:0});
  assert.equal(report.passed,true);
});
test("missing source artifacts always prevent full certification",()=>{
  const report=summarizeCertification(["a","b"],new Map([["a",certified("a")]]));
  assert.equal(report.passed,false);
  assert.deepEqual(report.stats,{expected:2,certified:1,failed:0,missing:1});
});
test("negative false positives and unknown routing cannot be certified",()=>{
  const falsePositive=certified("a");
  falsePositive.cases[2].pass=false;
  const noRoute=certified("b");
  noRoute.routeCoverage[0].routed=false;
  const report=summarizeCertification(["a","b"],new Map([["a",falsePositive],["b",noRoute]]));
  assert.equal(report.passed,false);
  assert.equal(report.stats.failed,2);
  assert.equal(report.rows.find(r=>r.id==="b").reason,"UNROUTED");
});
test("a source with one positive search and one empty search must fail",()=>{
  const item=certified("a");
  item.cases[1].validCount=0;
  const report=summarizeCertification(["a"],new Map([["a",item]]));
  assert.equal(report.passed,false);
});

test("registry shrink cannot turn a required 39-source certification green",()=>{
  const report=summarizeCertification(["a"],new Map([["a",certified("a")]]),39);
  assert.equal(report.stats.expected,1);
  assert.equal(report.requiredActiveCount,39);
  assert.equal(report.passed,false);
});
