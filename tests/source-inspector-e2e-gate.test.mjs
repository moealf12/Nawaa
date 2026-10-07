import test from "node:test";import assert from "node:assert/strict";import {evaluateEndToEnd} from "../server/source-inspector/e2e-gate.mjs";
const complete={profile:true,adapter:true,ingestion:true,normalization:true,validation:true,database:true,productResolution:true,search:true,api:true,frontend:true};
test("E2E gate opens only when every production stage has evidence",()=>{const r=evaluateEndToEnd(complete);assert.equal(r.passed,true);assert.equal(r.productionEligible,true);assert.deepEqual(r.missing,[])});
test("E2E gate fails closed when database or frontend proof is missing",()=>{const r=evaluateEndToEnd({...complete,database:false,frontend:false});assert.equal(r.passed,false);assert.deepEqual(r.missing,["database","frontend"])});
