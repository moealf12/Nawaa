// v21.65: server-only, cross-process audit receipts for already-issued
// scoped selected-PDP decisions. This is NOT a generic attestation endpoint.
// Possession of JSON, a hash, or a copied verifier decision cannot mint trust.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

const MAX_AGE_MS=5*60_000;
const MAX_BYTES=24_000;
const POLICY='trusted-pdp-journal-v1';
const HEX=/^[0-9a-f]{64}$/;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const parsedTime=v=>{
  const n=typeof v==='string'?Date.parse(v):NaN;
  return Number.isFinite(n)?n:NaN;
};
const safeObject=v=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function signed(key,event){
  return createHmac('sha256',key).update(
    POLICY+'\n'+event.kind+'\n'+event.ref+'\n'+event.payload).digest('hex');
}
function safeCompare(left,right){
  if(typeof left!=='string'||!HEX.test(left)||typeof right!=='string'||!HEX.test(right))return false;
  return timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));
}
function snapshotOffer(offer){
  if(!safeObject(offer))throw Error('invalid_selected_offer');
  // Allowlist excludes caller flags and unrelated historical catalog fields.
  const keys=['title','productPrice','currency','merchant','providerMarket',
    'sourceUrl','image','sku','gtin','mpn','modelNumber','availability',
    'condition','storage','capacity','ram','region','sim','color','edition',
    'bundleContents','observedAt'];
  const out=Object.fromEntries(keys.filter(k=>Object.hasOwn(offer,k))
    .map(k=>[k,offer[k]]));
  out.specs=Object.fromEntries(['brand','modelNumber','color','storage','capacity',
    'ram','region','sim','condition','gtin','mpn'].filter(k=>Object.hasOwn(offer.specs||{},k))
    .map(k=>[k,offer.specs[k]]));
  out.variant=Object.fromEntries(['storage','capacity','ram','region','sim','color',
    'edition','condition','bundleContents'].filter(k=>Object.hasOwn(offer.variant||{},k))
    .map(k=>[k,offer.variant[k]]));
  const json=JSON.stringify(out);
  if(!json||Buffer.byteLength(json)>MAX_BYTES)throw Error('observation_payload_budget');
  return JSON.parse(json);
}
function state(status,reason,additional={}){
  return Object.freeze({state:status,eligible:false,wholeOfferVerified:false,
    badgeEligible:false,reason,...additional});
}
// The signing key must be an independently provisioned server secret, never
// included in DB rows, request data, public source JSON or search responses.
// Store must implement append(event) and events(ref), with append-only writes.
export function createTrustedObservationJournal({store,signingKey,now=()=>Date.now(),
  maxAgeMs=MAX_AGE_MS}={}){
  if(!store||typeof store.append!=='function'||typeof store.events!=='function')
    throw TypeError('server_controlled_journal_store_required');
  const key=typeof signingKey==='string'?Buffer.from(signingKey):signingKey;
  if(!Buffer.isBuffer(key)||key.length<32)throw TypeError('strong_private_signing_key_required');
  if(typeof now!=='function'||!Number.isSafeInteger(maxAgeMs)||
    maxAgeMs<1||maxAgeMs>MAX_AGE_MS)throw RangeError('invalid_journal_ttl');
  const seal=(kind,ref,details)=>{
    const event={kind,ref,payload:JSON.stringify(details)};
    if(Buffer.byteLength(event.payload)>MAX_BYTES)throw Error('journal_payload_budget');
    return Object.freeze({...event,signature:signed(key,event)});
  };
  const valid=event=>safeObject(event)&&
    (event.kind==='capture'||event.kind==='revoke')&&
    typeof event.ref==='string'&&/^pdp-audit:[a-f0-9-]{36}$/.test(event.ref)&&
    typeof event.payload==='string'&&Buffer.byteLength(event.payload)<=MAX_BYTES&&
    safeCompare(event.signature,signed(key,event));
  async function inspect(ref,{expectedOffer}={}){
    if(typeof ref!=='string'||!/^pdp-audit:[a-f0-9-]{36}$/.test(ref))
      return state('MISSING_EVIDENCE','invalid_receipt_reference');
    let events;
    try{events=await store.events(ref);}
    catch{return state('SOURCE_BLOCKED','journal_unavailable');}
    if(!Array.isArray(events)||events.length===0)return state('MISSING_EVIDENCE','journal_receipt_missing');
    if(events.length>32||events.some(e=>!valid(e)||e.ref!==ref))
      return state('CONFLICTING_EVIDENCE','journal_integrity_failure');
    let captured=null,revoked=false;
    for(const event of events){
      let payload;
      try{payload=JSON.parse(event.payload);}
      catch{return state('CONFLICTING_EVIDENCE','invalid_receipt_payload');}
      if(!safeObject(payload))return state('CONFLICTING_EVIDENCE','invalid_receipt_payload');
      if(event.kind==='capture'){
        if(captured||revoked)return state('CONFLICTING_EVIDENCE','duplicate_or_reordered_capture');
        captured=payload;
      }else{
        if(!captured)return state('CONFLICTING_EVIDENCE','revoke_without_capture');
        revoked=true;
      }
    }
    if(!captured)return state('MISSING_EVIDENCE','missing_capture');
    if(captured.policy!==POLICY||captured.sourceId!=='jarir-sa'||
      !safeObject(captured.sourceRecord)||!HEX.test(captured.sourceRecord.recordId||'')||
      !HEX.test(captured.sourceRecord.documentDigest||'')||
      !HEX.test(captured.sourceRevision||'')||
      !safeObject(captured.predicates)||captured.scope!=='selected_pdp_revision_predicates'||
      captured.wholeOfferVerified!==false||captured.badgeEligible!==false||
      !safeObject(captured.offer)||typeof captured.offerDigest!=='string'||
      captured.offerDigest!==hash(captured.offer))
      return state('CONFLICTING_EVIDENCE','invalid_capture_contract');
    const observed=parsedTime(captured.observedAt),issued=parsedTime(captured.issuedAt);
    const present=now();
    if(!Number.isFinite(present)||!Number.isFinite(observed)||!Number.isFinite(issued)||
      issued<observed||issued-observed>60_000||issued>present+60_000)
      return state('CONFLICTING_EVIDENCE','invalid_capture_time');
    if(revoked)return state('REVOKED','journal_revoked',{sourceId:captured.sourceId,
      sourceRevision:captured.sourceRevision});
    if(present-observed>maxAgeMs)return state('EXPIRED','journal_observation_expired');
    if(expectedOffer!==undefined){
      try{if(hash(snapshotOffer(expectedOffer))!==captured.offerDigest)
        return state('CONFLICTING_EVIDENCE','offer_revision_mismatch');}
      catch{return state('CONFLICTING_EVIDENCE','invalid_expected_offer');}
    }
    // This revalidates the recorded, server-issued source predicate receipt;
    // it cannot independently replay merchant HTML from its digest alone.
    return state('REVALIDATED','source_predicate_receipt_valid',{
      eligible:true,receiptRef:ref,sourceId:captured.sourceId,
      sourceRevision:captured.sourceRevision,sourceRecord:captured.sourceRecord,
      observedAt:captured.observedAt,issuedAt:captured.issuedAt,
      policy:captured.policy,predicates:Object.freeze({...captured.predicates}),
      scope:captured.scope,offer:captured.offer
    });
  }
  async function archive(session,result){
    if(typeof session?.accepts!=='function'||typeof session?.evidence!=='function'||
      result?.state!=='VERIFIED'||result?.certificateScope!=='selected_pdp_revision_predicates'||
      result?.wholeOfferVerified!==false||result?.badgeEligible!==false||
      result?.decision?.state!=='VERIFIED')
      return state('MISSING_EVIDENCE','untrusted_issue_request');
    // Only a live issued decision in this server session can be archived.
    if(!await session.accepts(result))return state('MISSING_EVIDENCE','unaccepted_source_decision');
    const ev=session.evidence(result.observationRef);
    if(!ev||!ev.sourceRecord||!HEX.test(ev.sourceRecord.recordId||'')||
      !HEX.test(ev.sourceRecord.documentDigest||'')||
      !HEX.test(ev.revision||'')||ev.sourceId!=='jarir-sa'||
      ev.revision!==result.decision.evidenceRevision||
      result.decision.sourceId!==ev.sourceId||
      result.decision.observationRef!==result.observationRef)
      return state('MISSING_EVIDENCE','incomplete_source_lineage');
    const at=now(),observed=parsedTime(ev.observedAt);
    if(!Number.isFinite(at)||!Number.isFinite(observed)||observed>at+60_000||
      at-observed>maxAgeMs)return state('EXPIRED','stale_capture');
    let offer;
    try{offer=snapshotOffer(result.offer);}catch{return state('MISSING_EVIDENCE','unsupported_offer_payload');}
    const ref='pdp-audit:'+randomUUID();
    const receipt={
      policy:POLICY,sourceId:ev.sourceId,sourceObservationRef:ev.ref,
      sourceRevision:ev.revision,sourceRecord:ev.sourceRecord,
      observedAt:ev.observedAt,issuedAt:new Date(at).toISOString(),
      offer,offerDigest:hash(offer),predicates:result.decision.predicates,
      scope:result.certificateScope,wholeOfferVerified:false,badgeEligible:false
    };
    try{await store.append(seal('capture',ref,receipt));}
    catch{return state('SOURCE_BLOCKED','journal_write_failed');}
    return Object.freeze({state:'ARCHIVED',receiptRef:ref,sourceRevision:ev.revision,
      wholeOfferVerified:false,badgeEligible:false});
  }
  async function revoke(ref,reason='source_updated'){
    if(!['source_updated','identity_conflict','source_blocked','security_revoke']
      .includes(reason))return state('MISSING_EVIDENCE','invalid_revocation_reason');
    const previous=await inspect(ref);
    if(previous.state!=='REVALIDATED')return previous;
    try{await store.append(seal('revoke',ref,{
      reason,revokedAt:new Date(now()).toISOString(),sourceRevision:previous.sourceRevision
    }));}
    catch{return state('SOURCE_BLOCKED','journal_revocation_write_failed');}
    return state('REVOKED',reason);
  }
  return Object.freeze({archive,inspect,revoke,policyVersion:POLICY});
}
