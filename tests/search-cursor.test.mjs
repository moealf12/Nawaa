import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionPlan, decodeSearchCursor, encodeSearchCursor, MAX_SEARCH_DEPTH } from "../server/search-cursor.mjs";

test("search cursor is query-bound and acquisition depth expands monotonically",()=>{
  const token=encodeSearchCursor("hp",1,{now:1000});
  assert.equal(decodeSearchCursor(token,"hp",{now:2000}).depth,1);
  assert.throws(()=>decodeSearchCursor(token,"iphone",{now:2000}),/invalid_search_cursor/);
  const first=acquisitionPlan(0,43),deep=acquisitionPlan(MAX_SEARCH_DEPTH,43);
  assert.ok(deep.storefrontLimit>first.storefrontLimit);
  assert.ok(deep.productPageLimit>first.productPageLimit);
  assert.ok(deep.returnLimit>first.returnLimit);
});
