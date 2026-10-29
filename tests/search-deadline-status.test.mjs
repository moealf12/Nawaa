import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {observedDeadlineExceeded} from "../server/search-deadline-status.mjs";

test("JSON deadline status is true for observed post-budget completion even when timer did not fire",()=>{
  assert.equal(observedDeadlineExceeded(false,12000,22309),true);
  assert.equal(observedDeadlineExceeded(false,12000,12000),true);
  assert.equal(observedDeadlineExceeded(false,12000,11999),false);
  assert.equal(observedDeadlineExceeded(true,12000,100),true);
  assert.equal(observedDeadlineExceeded(false,Number.NaN,12000),false);
});

test("JSON completion checks actual deadline before coverage flags without clearing offers",()=>{
  const text=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  const begin=text.indexOf("async function searchAll(");
  const end=text.indexOf("const cachedSearch =",begin);
  assert.ok(begin>=0 && end>begin,"JSON search implementation boundaries");
  const code=text.slice(begin,end);
  assert.match(code,/deadlineExceeded = observedDeadlineExceeded\(deadlineExceeded, requestDeadlineAt\)/);
  assert.ok(code.indexOf("deadlineExceeded = observedDeadlineExceeded") <
    code.indexOf("partial:deadlineExceeded || errors.length>0"));
  assert.match(code,/offers: selectedOffers/);
});
