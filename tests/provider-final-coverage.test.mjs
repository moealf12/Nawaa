import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Structural performance invariant: provider completions arrive in parallel and
// may invoke streaming callbacks, but routing summary rescoring must run once
// after the complete chunk set. Existing search-provider-error-coverage and
// deadline integration tests verify that eligible offers survive partial failure.
test("provider routing computes final relevance once, not once per completed source", () => {
  const source=readFileSync(new URL("../server/server.mjs",import.meta.url),"utf8");
  const start=source.indexOf("async function runProviderPass(");
  const end=source.indexOf("async function searchExpansion(",start);
  assert.ok(start>=0 && end>start,"source pass boundaries must remain identifiable");
  const body=source.slice(start,end);
  assert.match(body,/while\(inFlight\.size\)/);
  assert.match(body,/chunks\.push\(settled\.chunk\)/);
  const calls=[...body.matchAll(/retainRelatedOffers\(matchingQuery,/g)];
  assert.equal(calls.length,1,"all settled chunks must be scored exactly once");
  const scoreAt=calls[0].index;
  assert.ok(scoreAt>body.indexOf("const merged=mergeProviderChunks")-500,
    "final scoring must occur after the provider settle loop");
  assert.match(body,/usefulCoverageReached:relevant\.length>=usefulThreshold && merchantCount>=merchantThreshold/);
  assert.match(body,/relevantOffers:relevant\.length/);
});
