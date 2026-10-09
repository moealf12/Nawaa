import test from "node:test";
import assert from "node:assert/strict";
import {SOURCE_BATCHES,validateSourceBatches} from "../scripts/certify-active-sources-batched.mjs";
import {configuredFreeStorefronts} from "../server/providers/free-storefronts.mjs";

test("eight groups cover exactly 39 enabled live stores, each once",()=>{
 const result=validateSourceBatches();
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(result.batchSizes,[5,5,5,5,5,5,5,4]);
 assert.equal(result.actual,39);
 const declared=SOURCE_BATCHES.flat().map(item=>item.id).sort();
 const active=configuredFreeStorefronts().map(item=>item.id).sort();
 assert.deepEqual(declared,active);
});

test("missing, duplicated or mismatched sources fail validation",()=>{
 const missing=SOURCE_BATCHES.map(group=>group.slice());
 missing[0]=missing[0].slice(1);
 assert.equal(validateSourceBatches(missing).ok,false);
 const duplicate=SOURCE_BATCHES.map(group=>group.map(item=>({...item})));
 duplicate[0][0].id=duplicate[0][1].id;
 const result=validateSourceBatches(duplicate);
 assert.equal(result.ok,false);
 assert.ok(result.duplicates.includes(duplicate[0][0].id));
 assert.ok(result.missing.length>0);
});

test("batch definition keeps two positive queries per source",()=>{
 for(const source of SOURCE_BATCHES.flat()){
   assert.equal(source.queries.length,2,source.id);
   assert.ok(source.queries.every(query=>typeof query==="string"&&query.trim().length>1),source.id);
   assert.notEqual(source.queries[0],source.queries[1],source.id);
 }
});
