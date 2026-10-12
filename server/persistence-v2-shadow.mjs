import {randomUUID} from 'node:crypto';
import {recordOffer as legacyRecordOffer} from './persistence.mjs';
import {recordOfferV2,assertEphemeralDatabase} from './persistence-v2.mjs';

// Opt-in migration seam only. Existing recordOffer(), persistOffers(), and search
// remain untouched. V2 shadow writes require an explicitly supplied isolated pool.
export async function recordOfferWithV2Shadow(offer, {
  env=process.env,
  legacy=legacyRecordOffer,
  v2=recordOfferV2,
  v2Pool,
  ingestionId=randomUUID(),
}={}) {
  const shadowRequested=env.NAWAA_PERSISTENCE_V2_SHADOW==='1';
  // Invalid opt-in configuration must fail before the irreversible legacy write.
  if(shadowRequested){
    if(!v2Pool)throw new Error('v2_shadow_requires_ephemeral_pool');
    assertEphemeralDatabase(env);
  }
  const legacyResult=await legacy(offer);
  if(!shadowRequested)
    return {legacyResult,shadow:{enabled:false}};
  // A failed shadow must never overwrite a successful legacy write.
  // This explicit path is reserved for CI experiments, not customer requests.
  try {
    const shadow=await v2(v2Pool,offer,{ingestionId});
    return {legacyResult,shadow:{enabled:true,ok:true,result:shadow}};
  } catch(error) {
    return {legacyResult,shadow:{enabled:true,ok:false,errorCode:String(error?.message||'shadow_error').slice(0,100)}};
  }
}
