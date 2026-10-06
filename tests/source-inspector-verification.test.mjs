import test from "node:test";import assert from "node:assert/strict";
import {evaluateSearchRuns,DEFAULT_SEARCH_CASES} from "../server/source-inspector/verification/search.mjs";
import {validateSemanticPrice} from "../server/source-inspector/verification/semantics.mjs";
import {verifyVariantIntegrity} from "../server/source-inspector/verification/variants.mjs";
test("adaptive search verification requires all query classes",()=>{const runs=DEFAULT_SEARCH_CASES.map((type,i)=>({type,resultCount:type==="zero-result"?0:10+i,duplicateRate:0,latencyMs:50}));assert.equal(evaluateSearchRuns(runs).passed,true)});
test("installment is not accepted as full product price",()=>{const r=validateSemanticPrice({text:"199 SAR / month"});assert.equal(r.model,"installment");assert.equal(r.validProductPrice,false)});
test("variant integrity rejects duplicate variant identity",()=>{const r=verifyVariantIntegrity([{sku:"A",capacity:"256GB",price:100},{sku:"A",capacity:"256GB",price:200}]);assert.equal(r.passed,false)});
