// v21.68: generation IDs correlate SSE messages; they are NOT signed product
// evidence, attestation authority, customer badge eligibility or T5 proof.
const GENERATION=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
// Once an EventSource receives its first valid meta, its identity is immutable.
export function pinStreamGeneration(pinned,incoming){
  if(typeof incoming!=='string'||!GENERATION.test(incoming))return null;
  if(pinned==null)return incoming;
  return pinned===incoming ? pinned : null;
}
export function acceptedStreamGeneration(expected,incoming){
  if(expected==null)return true; // Backward compatible with earlier API.
  return typeof expected==='string'&&GENERATION.test(expected)&&
    incoming===expected;
}
// A snapshot-level correlation marker is not a sellable-offer credential.
// Reject duplicated, reordered, cross-generation and user-supplied "verified"
// envelopes. Older backends can still show products, but without badge trust.
export function acceptDisplayTrustContext(expectedGeneration,snapshot,previousRevision=0){
  const frame=snapshot?.displayTrustContext;
  if(!frame||!acceptedStreamGeneration(expectedGeneration,snapshot?.streamGeneration)||
     typeof expectedGeneration!=='string'||!GENERATION.test(expectedGeneration)||
     frame.policy!=='display-snapshot-v1'||
     frame.scope!=='stream_snapshot_not_sellable_offer'||
     frame.streamGeneration!==expectedGeneration||
     !Number.isSafeInteger(frame.snapshotRevision)||frame.snapshotRevision<=0||
     !Number.isSafeInteger(previousRevision)||previousRevision<0||
     frame.snapshotRevision<=previousRevision||
     frame.customerVerified!==false||frame.badgeEligible!==false)return null;
  return Object.freeze({streamGeneration:expectedGeneration,
    snapshotRevision:frame.snapshotRevision,badgeEligible:false});
}
export function selectSearchStreamResult(latestSnapshot,latestWithOffers){
  if(!latestWithOffers)return latestSnapshot||null;
  if(!latestSnapshot)return latestWithOffers;
  // Mixed legacy/new generations must not contaminate the final canonical
  // snapshot. Legacy-only (both absent) remains backward compatible.
  if(latestSnapshot.streamGeneration||latestWithOffers.streamGeneration){
    if(!acceptedStreamGeneration(latestSnapshot.streamGeneration,
      latestWithOffers.streamGeneration)||
      !acceptedStreamGeneration(latestWithOffers.streamGeneration,
        latestSnapshot.streamGeneration))return latestSnapshot;
  }
  // The terminal snapshot did not own these earlier offers. Retaining
  // product visibility must NEVER retain terminal snapshot trust context.
  const {displayTrustContext:_unboundContext,...safeLatest}=latestSnapshot;
  return {...safeLatest,offers:latestWithOffers.offers};
}

// v21.71: a source-predicate SSE event is NON-AUTHORITATIVE browser telemetry.
// It never signs, validates, grants or transfers a customer-facing credential.
// Require current server generation and same delivered snapshot occurrence.
const HEX64=/^[a-f0-9]{64}$/;
export function acceptSourcePredicateDiagnostic(
  expectedGeneration,expectedRevision,frame,offers,previousDiagnosticRevision=0
){
  if(typeof expectedGeneration!=='string'||!GENERATION.test(expectedGeneration)||
     !Number.isSafeInteger(expectedRevision)||expectedRevision<=0||
     !Number.isSafeInteger(previousDiagnosticRevision)||previousDiagnosticRevision<0||
     !frame||typeof frame!=='object'||Array.isArray(frame)||
     frame.policy!=='pdp-predicate-shadow-v1'||
     frame.scope!=='selected_pdp_revision_predicates'||
     frame.streamGeneration!==expectedGeneration||
     frame.snapshotRevision!==expectedRevision||
     frame.snapshotRevision<=previousDiagnosticRevision||
     frame.sourceId!=='jarir-sa'||!HEX64.test(frame.sourceRevision||'')||
     !HEX64.test(frame.sourceRecordId||'')||
     !Number.isSafeInteger(frame.offerIndex)||frame.offerIndex<0||
     !Array.isArray(offers)||frame.offerIndex>=offers.length||
     offers[frame.offerIndex]?.providerMarket!==frame.sourceId||
     frame.sourcePredicatesRevalidated!==true||
     frame.wholeOfferVerified!==false||
     frame.badgeEligible!==false||frame.customerVerified!==false||
     frame.t5Eligible!==false||frame.paintCertified!==false||
     frame.durableProof!==false)return null;
  return Object.freeze({classification:'SOURCE_PREDICATE_TELEMETRY_ONLY',
    streamGeneration:expectedGeneration,snapshotRevision:expectedRevision,
    offerIndex:frame.offerIndex,sourceId:frame.sourceId,
    sourceRevision:frame.sourceRevision,
    badgeEligible:false,customerVerified:false,t5Eligible:false});
}
