import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionPlan, decodeSearchCursor, encodeSearchCursor, MAX_SEARCH_DEPTH } from "../server/search-cursor.mjs";

test("search cursor is query-bound and acquisition depth expands monotonically",()=>{
  const token=encodeSearchCursor("hp",1,{now:1000});
  assert.equal(decodeSearchCursor(token,"hp",{now:2000}).depth,1);
  assert.throws(()=>decodeSearchCursor(token,"iphone",{now:2000}),/invalid_search_cursor/);
  const first=acquisitionPlan(0,43),second=acquisitionPlan(1,43),deep=acquisitionPlan(MAX_SEARCH_DEPTH,43);
  assert.equal(first.jarirLimit,96);
  assert.equal(second.jarirLimit,0);
  assert.equal(second.storefrontOffset,first.storefrontOffset+first.storefrontLimit);
  assert.equal(deep.storefrontOffset,second.storefrontOffset+second.storefrontLimit);
  assert.equal(second.amazonPageStart,first.amazonPageStart+first.amazonPageCount);
  assert.equal(deep.amazonPageCount,0);
  assert.ok(deep.productPageLimit>first.productPageLimit);
  assert.ok(deep.returnLimit>first.returnLimit);
});
