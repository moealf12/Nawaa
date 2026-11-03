import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanonicalHydration,verifyLiveCanonicalExposure,
} from "../scripts/omega-live-evidence-assertions.mjs";

const original={
  sourceUrl:"https://www.jarir.com/sa-en/sony-ps5-console.html",
  condition:"new",
};
const state={
  revision:7,
  fingerprint:"trusted-postgres-sha",
  observedAt:"2026-11-03T16:35:15.000Z",
  offer:{productPrice:2300,availability:"unknown"},
};
const canonical={
  ...original,
  productPrice:2300,canonicalRevision:7,
  canonicalFingerprint:"trusted-postgres-sha",
  observedAt:state.observedAt,
};
const input=offers=>({identity:original,state,...offers});

test("R04 P3: an independently missing live listing is NOT fabricated as an out-of-stock result",()=>{
  const absent=verifyLiveCanonicalExposure([],input());
  assert.deepEqual(absent,{observed:false,matched:0});
  assert.throws(()=>assertCanonicalHydration([],input()),
    /expected_one_authoritative_canonical_identity/);
  assert.deepEqual(verifyLiveCanonicalExposure([
    {...canonical,sourceUrl:"https://example.org/other"},
    {...canonical,condition:"renewed"},
  ],input()),{observed:false,matched:0});
});
test("R04 P3: authoritative PostgreSQL canonical hydration is mandatory and exact",()=>{
  assert.equal(assertCanonicalHydration([canonical],input()).canonicalRevision,7);
  assert.deepEqual(verifyLiveCanonicalExposure([canonical],input()),
    {observed:true,matched:1});
});
test("R04 P3: if exposed, an older canonical revision, fingerprint, price or observed time FAILS",()=>{
  for(const wrong of [
    {...canonical,canonicalRevision:6},
    {...canonical,canonicalFingerprint:"old"},
    {...canonical,productPrice:2299},
    {...canonical,observedAt:"2026-11-03T16:34:00.000Z"},
  ]){
    assert.throws(()=>verifyLiveCanonicalExposure([wrong],input()),/AssertionError|canonical_|stale_|source_observation/);
    assert.throws(()=>assertCanonicalHydration([wrong],input()),/AssertionError|canonical_|stale_|source_observation/);
  }
});
test("R04 P3: malformed canonical state cannot turn a missing HTTP offer into success",()=>{
  assert.throws(()=>verifyLiveCanonicalExposure([canonical],
    {identity:original,state:{revision:7}}),/authoritative_canonical_state_required/);
  assert.throws(()=>assertCanonicalHydration([canonical],
    {identity:original,state:{revision:7}}),/authoritative_canonical_state_required/);
  assert.throws(()=>verifyLiveCanonicalExposure(null,input()),/customer_offer_array_required/);
  assert.throws(()=>assertCanonicalHydration(null,input()),/canonical_hydration_array_required/);
});
