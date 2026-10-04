import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../server/rate-limit.mjs";

test("rate limiter enforces burst cost and refills deterministically",()=>{
  let now=0;
  const consume=createRateLimiter({now:()=>now,maxEntries:10});
  assert.equal(consume("client",{capacity:2,refillPerSecond:1}).ok,true);
  assert.equal(consume("client",{capacity:2,refillPerSecond:1}).ok,true);
  const denied=consume("client",{capacity:2,refillPerSecond:1});
  assert.equal(denied.ok,false);
  assert.ok(denied.retryAfterMs>=1000);
  now=1000;
  assert.equal(consume("client",{capacity:2,refillPerSecond:1}).ok,true);
});
