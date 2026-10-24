// v21.68: generation IDs correlate SSE messages; they are NOT signed product
// evidence, attestation authority, customer badge eligibility or T5 proof.
const GENERATION=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function acceptedStreamGeneration(expected,incoming){
  if(expected==null)return true; // Backward compatible with earlier API.
  return typeof expected==='string'&&GENERATION.test(expected)&&
    incoming===expected;
}
export function selectSearchStreamResult(latestSnapshot,latestWithOffers){
  if(!latestWithOffers)return latestSnapshot||null;
  if(!latestSnapshot)return latestWithOffers;
  if(latestSnapshot.streamGeneration&&latestWithOffers.streamGeneration&&
     !acceptedStreamGeneration(latestSnapshot.streamGeneration,
       latestWithOffers.streamGeneration))return latestSnapshot;
  return {...latestSnapshot,offers:latestWithOffers.offers};
}
