import test from "node:test";
import assert from "node:assert/strict";
import {assessCustomerSearchPayload} from "../scripts/r06-live-contract.mjs";

const offer={title:"HP Pavilion 16GB",merchant:"eXtra",productPrice:2799,currency:"SAR",
  sourceUrl:"https://www.extra.com/en-sa/p/100462492"};
const make=(overrides={})=>({offers:[offer],errors:[],
  coverage:{complete:true,partial:false,deadlineExceeded:false,providersPending:0,
    sourceFailures:{errorsReported:0}},...overrides});

test("R06-D complete evidence with valid offer is accepted",()=>{
  assert.equal(assessCustomerSearchPayload(make()).pass,true);
});
test("R06-D failed merchant preserves valid offer and honest PARTIAL",()=>{
  const x=make({errors:[{sourceId:"jarir-direct",error:"timeout"}],
    coverage:{complete:false,partial:true,deadlineExceeded:false,providersPending:0,
      sourceFailures:{errorsReported:1}},cache:{mode:"miss"}});
  const result=assessCustomerSearchPayload(x);
  assert.equal(result.pass,true,JSON.stringify(result));
  assert.equal(result.offers,1);
});
test("R06-D must reject source error incorrectly called COMPLETE",()=>{
  const x=make({errors:[{sourceId:"amazon",error:"HTTP 403"}],
    coverage:{complete:true,partial:false,deadlineExceeded:false,providersPending:0,
      sourceFailures:{errorsReported:1}}});
  assert.ok(assessCustomerSearchPayload(x).failures.includes("FALSE_COMPLETE"));
});
test("R06-D accepts unknown pending only for JSON timeout, never completed wave",()=>{
  const x=make({coverage:{complete:false,partial:true,deadlineExceeded:true,
    providersPending:null,sourceFailures:{errorsReported:0}}});
  assert.equal(assessCustomerSearchPayload(x).pass,true);
  assert.ok(assessCustomerSearchPayload(x,{stream:true}).failures.includes("PENDING_EVIDENCE"));
  x.coverage.complete=true;x.coverage.partial=false;
  assert.equal(assessCustomerSearchPayload(x).pass,false);
});
test("R06-D cannot turn partial source error into FRESH cache",()=>{
  const x=make({errors:[{sourceId:"jarir-direct",error:"timeout"}],
    coverage:{complete:false,partial:true,deadlineExceeded:false,providersPending:0,
      sourceFailures:{errorsReported:1}},cache:{mode:"fresh"}});
  assert.ok(assessCustomerSearchPayload(x).failures.includes("PARTIAL_FRESH_CACHE"));
});
test("R06-D missing source-error counters or provider counts are UNKNOWN not PASS",()=>{
  const x=make();
  delete x.coverage.providersPending;
  assert.ok(assessCustomerSearchPayload(x).failures.includes("PENDING_EVIDENCE"));
  x.coverage.providersPending=0;
  delete x.coverage.sourceFailures;
  assert.ok(assessCustomerSearchPayload(x).failures.includes("ERROR_COUNTER"));
});
test("R06-D refuses false prices and URLs without valid https merchant ownership",()=>{
  for(const invalid of [{...offer,productPrice:0},{...offer,sourceUrl:"javascript:alert(1)"},
    {...offer,sourceUrl:"https://u:p@www.extra.com/p/2"},{...offer,currency:""}]){
    assert.equal(assessCustomerSearchPayload(make({offers:[invalid]})).pass,false);
  }
});
test("R06-D source failure count must reconcile with reported errors",()=>{
  const x=make({coverage:{complete:false,partial:true,deadlineExceeded:false,providersPending:0,
    sourceFailures:{errorsReported:1}},cache:{mode:"miss"}});
  assert.ok(assessCustomerSearchPayload(x).failures.includes("ERROR_COUNTER_MISMATCH"));
});
