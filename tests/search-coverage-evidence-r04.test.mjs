import test from "node:test";
import assert from "node:assert/strict";
import {summarizeWaveSourceEvidence} from "../server/search-coverage-evidence.mjs";

test("R04: connector reports never assert worldwide coverage or zero merchant stock",()=>{
 const evidence=summarizeWaveSourceEvidence([
   {sourceId:"jarir-direct",ok:true,returnedOffers:30},
   {sourceId:"extra-unbxd",ok:false,returnedOffers:0},
   {sourceId:"free-storefronts",returnedOffers:9},
 ],[{sourceId:"extra-unbxd",error:"HTTP 403"}]);
 assert.deepEqual(evidence,{
   providerReports:3,reportsWithOffers:2,connectorReportedOffers:39,
   reportedSuccess:1,reportedNoSuccess:1,outcomeUnknown:1,
   errorReports:1,exhaustive:false,
 });
 assert.equal(summarizeWaveSourceEvidence([],[]).exhaustive,false);
});
test("R04: reject malformed counters instead of multiplying nonexistent offers",()=>{
 const result=summarizeWaveSourceEvidence([
 {ok:true,returnedOffers:-1},{ok:false,returnedOffers:Infinity},
 {returnedOffers:"12"},{returnedOffers:2.1},{ok:true,returnedOffers:8},
 ]);
 assert.equal(result.connectorReportedOffers,8);
 assert.equal(result.reportedNoSuccess,1);
 assert.equal(result.outcomeUnknown,2);
});
