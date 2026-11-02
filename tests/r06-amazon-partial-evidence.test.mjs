import test from "node:test";
import assert from "node:assert/strict";
import {assessAmazonPageEvidence,amazonPartialEvidenceError} from "../server/amazon-page-evidence.mjs";

const observed=(pagesRequested,pagesFetched,overrides={})=>({
  offers:[{merchant:"Amazon Saudi",productPrice:1999,currency:"SAR"}],
  failures:0,
  diagnostics:{
    searchPage:{pagesRequested,pagesFetched,blockedReason:null},
    primarySearchError:null,sourceAccessFailure:null,
  },
  ...overrides,
});

test("R06-B: complete five-page Amazon wave has no invented source failure",()=>{
  const evidence=assessAmazonPageEvidence(5,observed(5,5));
  assert.equal(evidence.complete,true);
  assert.equal(amazonPartialEvidenceError(5,observed(5,5),"primary"),null);
});

test("R06-B: one failed Amazon page preserves independent valid offers but marks partial",()=>{
  const result=observed(5,4);
  const evidence=assessAmazonPageEvidence(5,result);
  assert.equal(evidence.complete,false);
  assert.equal(evidence.reason,"page_fetch_incomplete");
  assert.equal(result.offers.length,1,"the caller must never drop independently verified offers");
  assert.deepEqual(amazonPartialEvidenceError(5,result,"primary"),{
    provider:"free-storefronts",sourceId:"free-storefronts:amazon-sa",
    pass:"primary",error:"amazon_incomplete_source_evidence",
  });
});

test("R06-B: no page evidence is UNKNOWN, never a complete source wave",()=>{
  for(const data of [null,{offers:[{productPrice:99}],diagnostics:null},
    {offers:[{productPrice:99}],diagnostics:{searchPage:{pagesRequested:5}}}]){
    assert.equal(assessAmazonPageEvidence(5,data).complete,false);
  }
});

test("R06-B: inconsistent requested count cannot certify a completed plan",()=>{
  for(const result of [observed(3,3),observed(6,6),observed(5,6),observed("5","5"),observed(5,-1)]){
    assert.equal(assessAmazonPageEvidence(5,result).complete,false);
  }
});

test("R06-B: blocked and failed source never becomes complete despite parsed offers",()=>{
  for(const result of [
    observed(5,5,{failures:1}),
    observed(5,5,{error:"timeout"}),
    observed(5,5,{errors:[{error:"HTTP 503"}]}),
    observed(5,5,{diagnostics:{searchPage:{pagesRequested:5,pagesFetched:5,blockedReason:"challenge"}}}),
    observed(5,5,{diagnostics:{searchPage:{pagesRequested:5,pagesFetched:5},primarySearchError:"denied"}}),
    observed(5,5,{diagnostics:{searchPage:{pagesRequested:5,pagesFetched:5},sourceAccessFailure:"HTTP_403_ACCESS_DENIED"}}),
  ]) assert.equal(assessAmazonPageEvidence(5,result).complete,false);
});

test("R06-B: a cursor wave with zero Amazon pages adds no source failure",()=>{
  assert.equal(assessAmazonPageEvidence(0,null).complete,true);
  assert.equal(amazonPartialEvidenceError(0,null,"expansion"),null);
});

test("R06-B: bounded expansion wave records the correct pass label",()=>{
  assert.deepEqual(amazonPartialEvidenceError(3,observed(3,2),"expansion"),{
    provider:"free-storefronts",sourceId:"free-storefronts:amazon-sa",
    pass:"expansion",error:"amazon_incomplete_source_evidence",
  });
});
