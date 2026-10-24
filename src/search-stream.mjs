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
