import test from "node:test";
import assert from "node:assert/strict";
import {detectPageModel} from "../server/source-inspector/discovery/page-model.mjs";

test("detects page model from pg and pageSize parameters",()=>{
 const result=detectPageModel("https://shop.example/facet/?pg=1&pageSize=24");
 assert.equal(result.ok,true);
 assert.equal(result.model,"page");
});

test("detects cursor and offset models",()=>{
 assert.equal(detectPageModel("https://shop.example/api?cursor=abc").model,"cursor");
 assert.equal(detectPageModel("https://shop.example/api?offset=24").model,"offset");
});
