// v21.71: trust-claim egress boundary for actual customer SSE snapshots.
// The selected product, prices and source provenance fields pass unchanged;
// self-asserted trust certificates/booleans do NOT. Never infer customer
// verification from an offer's free-form fields or sourceMeta metadata.
const BLOCKED=new Set([
  'badgeEligible','customerVerified','wholeOfferVerified','t5Eligible',
  'firstTrustworthyOfferEligible','sourcePredicatesRevalidated',
  'independentlyAttested','trustedVerifier','verificationStatus',
  'trustCertification','evidenceDigest','certificateScope',
  'sourcePredicateEvidence','sourcePredicates','sourceVerification',
  'trustBadge','trustBadgeEligible','trustReceipt','attestationReceipt',
  'signedAttestation','trustedDisplayOwnership','displayTrustContext',
  'streamGeneration','verified','issuer','isVerified','verifiedBy',
  'verifiedSource','certification','verificationDecision'
]);
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const forbidden=(key)=>BLOCKED.has(key)||/^__nawaaTrust|^_trust[A-Z]/.test(key);
function scrubRecord(record){
  if(!record||typeof record!=='object'||Array.isArray(record))return record;
  let changed=false;
  for(const key of Object.keys(record)){
    if(forbidden(key)){changed=true;break;}
  }
  if(!changed)return record;
  const clean={};
  for(const [key,value] of Object.entries(record)){
    if(!forbidden(key))Object.defineProperty(clean,key,{value,configurable:true,
      enumerable:true,writable:true});
  }
  return clean;
}
export function stripUntrustedCustomerTrustClaims(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))return snapshot;
  const safe={};
  // Explicitly discard ANY inbound frame-level trust envelope, even when
  // supplied by a malicious upstream cache/provider or a quoted JSON record.
  for(const [key,value] of Object.entries(snapshot)){
    if(!forbidden(key)&&key!=='offers')
      Object.defineProperty(safe,key,{value,configurable:true,
        enumerable:true,writable:true});
  }
  if(Array.isArray(snapshot.offers)){
    safe.offers=snapshot.offers.map(offer=>{
      if(!offer||typeof offer!=='object'||Array.isArray(offer))return offer;
      const cleaned=scrubRecord(offer);
      if(!hasOwn(cleaned,'sourceMeta'))return cleaned;
      const meta=scrubRecord(cleaned.sourceMeta);
      if(meta===cleaned.sourceMeta)return cleaned;
      return {...cleaned,sourceMeta:meta};
    });
  }else if(hasOwn(snapshot,'offers')){
    safe.offers=snapshot.offers;
  }
  return safe;
}
