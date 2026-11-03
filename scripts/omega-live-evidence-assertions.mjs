// Evidence assertions for the isolated Omega customer acceptance run.
// Provider acquisitions are not repeatable: losing a merchant offer between
// independent HTTP calls is NOT a canonical-revision integrity failure.
// If the identity IS present, its data MUST equal the authoritative state.
// A separate mandatory canonicalReadBoundary assertion proves hydration
// even when later merchant discovery no longer produces that identity.
import assert from "node:assert/strict";

function sameIdentity(offer, identity){
  return offer?.sourceUrl===identity?.sourceUrl &&
    String(offer?.condition||"new").toLowerCase()===
    String(identity?.condition||"new").toLowerCase();
}

function assertState(candidate,state){
  assert.ok(state && Number.isSafeInteger(state.revision) &&
    state.revision>0 && typeof state.fingerprint==="string" &&
    state.offer && typeof state.offer.productPrice==="number",
    "authoritative_canonical_state_required");
  assert.equal(candidate.canonicalRevision,state.revision,
    "stale_canonical_revision_exposed");
  assert.equal(candidate.canonicalFingerprint,state.fingerprint,
    "stale_canonical_fingerprint_exposed");
  assert.equal(candidate.productPrice,state.offer.productPrice,
    "stale_canonical_price_exposed");
  assert.equal(Date.parse(candidate.observedAt),
    Date.parse(state.observedAt),"source_observation_time_changed");
}

export function assertCanonicalHydration(candidates,{identity,state}={}){
  assert.ok(Array.isArray(candidates),"canonical_hydration_array_required");
  const matched=candidates.filter(offer=>sameIdentity(offer,identity));
  assert.equal(matched.length,1,
    "expected_one_authoritative_canonical_identity");
  assertState(matched[0],state);
  return matched[0];
}

export function verifyLiveCanonicalExposure(offers,{identity,state}={}){
  assert.ok(Array.isArray(offers),"customer_offer_array_required");
  const matched=offers.filter(offer=>sameIdentity(offer,identity));
  // A merchant can legitimately omit a listing in the NEXT live fetch.
  // That is unobserved, NOT confirmed out-of-stock and NOT passed as a
  // customer-facing price. A deterministic canonical hydration proof runs
  // separately and is mandatory for every acceptance run.
  for(const offer of matched)assertState(offer,state);
  return {observed:matched.length>0,matched:matched.length};
}
