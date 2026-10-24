// v21.65: server-only, cross-process audit receipts for already-issued
// scoped selected-PDP decisions. This is NOT a generic attestation endpoint.
// Possession of JSON, a hash, or a copied verifier decision cannot mint trust.
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {inspectIssuedPdpReceipt} from './trusted-pdp-observation.mjs';
import {createTrustedJournalKeyring} from './trusted-journal-keyring.mjs';
import {trustedSourceSubjectKey,SOURCE_SUBJECT_KEY_POLICY} from './trusted-source-subject-key.mjs';

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
    POLICY+'\n'+event.keyId+'\n'+event.kind+'\n'+event.ref+'\n'+event.payload).digest('hex');
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
// Preserve bounded source-owned values and extraction lineage for future
// independent audit. A source digest alone cannot reconstruct those values.
// This additional signed evidence remains PREDICATE-SCOPED, not a certificate.
function boundedSourceEvidence(evidence){
  const record=snapshotOffer({...evidence.selectedRecord,
    observedAt:evidence.observedAt});
  const raw=evidence.fieldOwnership;
  if(!safeObject(raw)||Object.keys(raw).length>32)
    throw Error('missing_bounded_source_lineage');
  const ownership={};
  for(const name of Object.keys(raw).sort()){
    if(!/^[a-zA-Z]{2,32}$/.test(name)||!safeObject(raw[name]))throw Error('invalid_field_lineage');
    const item=raw[name];
    if(typeof item.strategy!=='string'||item.strategy.length>64||
       item.recordId!==null&&typeof item.recordId!=='string')
      throw Error('invalid_field_lineage');
    ownership[name]={strategy:item.strategy,recordId:item.recordId};
  }
  return {schema:'selected-source-record-evidence-v1',record,
    ownership,recordDigest:hash(record)};
}
function state(status,reason,additional={}){
  return Object.freeze({state:status,eligible:false,wholeOfferVerified:false,
    badgeEligible:false,reason,...additional});
}
// The signing key must be an independently provisioned server secret, never
// included in DB rows, request data, public source JSON or search responses.
// Store must implement append(event) and events(ref), with append-only writes.
export function createTrustedObservationJournal({store,signingKey,keyring,
  requireCurrentHead=false,now=()=>Date.now(),maxAgeMs=MAX_AGE_MS}={}){
  if(!store||typeof store.append!=='function'||typeof store.events!=='function')
    throw TypeError('server_controlled_journal_store_required');
  // No accidental legacy signer or non-head-backed verifier in production.
  // No production store is activated by this module alone.
  if(process.env.NODE_ENV==='production'&&
    (signingKey!==undefined||!keyring||requireCurrentHead!==true))
    throw TypeError('production_journal_requires_private_keyring_and_current_head');
  // signingKey supports existing isolated v21.65 tests. Deployment adapters
  // must provision keyring via trustedJournalKeyringFromEnv(); no fallback.
  if(signingKey!==undefined&&keyring!==undefined)
    throw TypeError('ambiguous_journal_key_authority');
  const legacy=typeof signingKey==='string'?Buffer.from(signingKey):signingKey;
  if(!keyring&&(!Buffer.isBuffer(legacy)||legacy.length<32))
    throw TypeError('strong_private_signing_key_required');
  const keys=keyring??createTrustedJournalKeyring({activeKeyId:'legacy',keys:{legacy}});
  const key=keys.get(keys.activeKeyId);
  if(!key||!keys.activeKeyId)throw TypeError('missing_active_journal_key');
  if(typeof requireCurrentHead!=='boolean'||requireCurrentHead&&
    (typeof store.appendCapture!=='function'||typeof store.currentHead!=='function'))
    throw TypeError('current_source_head_store_required');
  if(typeof now!=='function'||!Number.isSafeInteger(maxAgeMs)||
    maxAgeMs<1||maxAgeMs>MAX_AGE_MS)throw RangeError('invalid_journal_ttl');
  const seal=(kind,ref,details)=>{
    const event={kind,ref,keyId:keys.activeKeyId,payload:JSON.stringify(details)};
    if(Buffer.byteLength(event.payload)>MAX_BYTES)throw Error('journal_payload_budget');
    return Object.freeze({...event,signature:signed(key,event)});
  };
  const valid=event=>safeObject(event)&&
    (event.kind==='capture'||event.kind==='revoke')&&
    typeof event.ref==='string'&&/^pdp-audit:[a-f0-9-]{36}$/.test(event.ref)&&
    typeof event.payload==='string'&&Buffer.byteLength(event.payload)<=MAX_BYTES&&
    typeof event.keyId==='string'&&Boolean(keys.get(event.keyId))&&
    safeCompare(event.signature,signed(keys.get(event.keyId),event));
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
      captured.offerDigest!==hash(captured.offer)||
      requireCurrentHead&&(!HEX.test(captured.sourceKey||'')||
        captured.sourceKeyPolicy!==SOURCE_SUBJECT_KEY_POLICY||
        captured.sourceKey!==trustedSourceSubjectKey(
          captured.sourceId,captured.offer.sku,captured.offer.sourceUrl)))
      return state('CONFLICTING_EVIDENCE','invalid_capture_contract');
    // Legacy scoped receipts remain readable. New receipts carry signed
    // reconstructible selected-record facts, without a trust-scope upgrade.
    // A persisted selection URL is source relationship evidence; it must
    // never contradict the actual selected sellable purchase destination.
    if(captured.sourceRecord.selectedOfferUrl!==undefined){
      if(typeof captured.sourceRecord.selectedOfferUrl!=='string'||
         captured.sourceRecord.selectedOfferUrl!==captured.offer.sourceUrl)
        return state('CONFLICTING_EVIDENCE','selected_offer_destination_conflict');
    }
    if(captured.sourceRecord.selectedProductUrl!==undefined){
      if(typeof captured.sourceRecord.selectedProductUrl!=='string'||
         !/^https:\/\//.test(captured.sourceRecord.selectedProductUrl))
        return state('CONFLICTING_EVIDENCE','selected_product_destination_invalid');
    }
    if(captured.sourceEvidence!==undefined){
      let evidence;
      try{evidence=boundedSourceEvidence({
        selectedRecord:captured.sourceEvidence.record,
        observedAt:captured.observedAt,
        fieldOwnership:captured.sourceEvidence.ownership
      });}catch{return state('CONFLICTING_EVIDENCE','invalid_source_evidence_payload');}
      if(captured.sourceEvidence.schema!==evidence.schema||
         captured.sourceEvidence.recordDigest!==evidence.recordDigest||
         JSON.stringify(captured.sourceEvidence)!==JSON.stringify(evidence))
        return state('CONFLICTING_EVIDENCE','source_evidence_integrity_failure');
    }
    const observed=parsedTime(captured.observedAt),issued=parsedTime(captured.issuedAt);
    const present=now();
    if(!Number.isFinite(present)||!Number.isFinite(observed)||!Number.isFinite(issued)||
      issued<observed||issued-observed>60_000||issued>present+60_000)
      return state('CONFLICTING_EVIDENCE','invalid_capture_time');
    if(revoked)return state('REVOKED','journal_revoked',{sourceId:captured.sourceId,
      sourceRevision:captured.sourceRevision});
    if(present-observed>maxAgeMs)return state('EXPIRED','journal_observation_expired');
    if(requireCurrentHead){
      let latest;
      try{latest=await store.currentHead(captured.sourceKey)}
      catch{return state('SOURCE_BLOCKED','source_head_read_unavailable');}
      if(!latest||!HEX.test(latest.revision||'')||
        !HEX.test(latest.recordId||'')||
        !Number.isFinite(parsedTime(latest.observedAt)))
        return state('SOURCE_BLOCKED','source_head_missing_or_invalid');
      if(latest.conflicted===true)
        return state('CONFLICTING_EVIDENCE','source_head_conflict');
      if(latest.revision!==captured.sourceRevision||
        latest.recordId!==captured.sourceRecord.recordId||
        parsedTime(latest.observedAt)!==observed)
        return state('SUPERSEDED','source_record_revision_changed');
    }
    if(expectedOffer!==undefined){
      try{if(hash(snapshotOffer(expectedOffer))!==captured.offerDigest)
        return state('CONFLICTING_EVIDENCE','offer_revision_mismatch');}
      catch{return state('CONFLICTING_EVIDENCE','invalid_expected_offer');}
    }
    // This revalidates the recorded, server-issued source predicate receipt;
    // it cannot independently replay merchant HTML from its digest alone.
    return state('REVALIDATED','source_predicate_receipt_valid',{
      sourcePredicatesRevalidated:true,receiptRef:ref,sourceId:captured.sourceId,
      sourceRevision:captured.sourceRevision,sourceRecord:captured.sourceRecord,
      observedAt:captured.observedAt,issuedAt:captured.issuedAt,
      policy:captured.policy,predicates:Object.freeze({...captured.predicates}),
      scope:captured.scope,offer:captured.offer,
      sourceEvidence:captured.sourceEvidence??null
    });
  }
  async function archive(result){
    // Private WeakMap registration in the original selected-PDP module is
    // mandatory. Duck-typed acceptors and copied JSON are not authority.
    const issued=await inspectIssuedPdpReceipt(result);
    if(!issued||result.state!=='VERIFIED'||
      result.certificateScope!=='selected_pdp_revision_predicates'||
      result.wholeOfferVerified!==false||result.badgeEligible!==false||
      result.decision?.state!=='VERIFIED')
      return state('MISSING_EVIDENCE','untrusted_issue_request');
    const ev=issued.evidence;
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
    let offer,sourceEvidence;
    try{
      offer=snapshotOffer(result.offer);
      sourceEvidence=boundedSourceEvidence(ev);
    }catch{return state('MISSING_EVIDENCE','unsupported_offer_or_source_payload');}
    const ref='pdp-audit:'+randomUUID();
    const sourceKey=trustedSourceSubjectKey(ev.sourceId,offer.sku,offer.sourceUrl);
    if(!sourceKey)return state('MISSING_EVIDENCE','invalid_selected_source_identity');
    const receipt={
      policy:POLICY,sourceId:ev.sourceId,sourceKey,
      sourceKeyPolicy:SOURCE_SUBJECT_KEY_POLICY,sourceObservationRef:ev.ref,
      sourceRevision:ev.revision,sourceRecord:ev.sourceRecord,
      observedAt:ev.observedAt,issuedAt:new Date(at).toISOString(),
      offer,offerDigest:hash(offer),sourceEvidence,
      predicates:result.decision.predicates,
      scope:result.certificateScope,wholeOfferVerified:false,badgeEligible:false
    };
    const event=seal('capture',ref,receipt);
    if(requireCurrentHead){
      const binding={sourceKey,observedAt:ev.observedAt,
        revision:ev.revision,recordId:ev.sourceRecord.recordId};
      let accepted;
      try{accepted=await store.appendCapture(event,binding)}
      catch{return state('SOURCE_BLOCKED','journal_write_failed');}
      if(accepted!==true)return state('SUPERSEDED','source_capture_not_latest');
    }else{
      try{await store.append(event)}
      catch{return state('SOURCE_BLOCKED','journal_write_failed');}
    }
    return Object.freeze({state:'ARCHIVED',receiptRef:ref,sourceRevision:ev.revision,
      wholeOfferVerified:false,badgeEligible:false});
  }
  // v21.67: ingest a freshly controlled selected PDP decision as the next
  // source revision WITHOUT issuing a new signed customer-visible receipt.
  // Only an original in-process opaque verifier result can advance the head.
  // Index/search/catalog offers and arbitrary evidence JSON cannot call this
  // path successfully. The caller must use a session that just fetched PDP.
  async function recordFreshSource(result){
    if(!requireCurrentHead||typeof store.advanceHead!=='function')
      return state('SOURCE_BLOCKED','source_head_ingestion_unavailable');
    const issued=await inspectIssuedPdpReceipt(result);
    if(!issued||result?.state!=='VERIFIED'||
      result.certificateScope!=='selected_pdp_revision_predicates'||
      result.wholeOfferVerified!==false||result.badgeEligible!==false||
      result.decision?.state!=='VERIFIED')
      return state('MISSING_EVIDENCE','untrusted_source_ingestion');
    const ev=issued.evidence;
    if(!ev||ev.sourceId!=='jarir-sa'||!HEX.test(ev.revision||'')||
      !HEX.test(ev.sourceRecord?.recordId||'')||
      !HEX.test(ev.sourceRecord?.documentDigest||'')||
      ev.revision!==result.decision.evidenceRevision||
      ev.ref!==result.decision.observationRef)
      return state('MISSING_EVIDENCE','invalid_controlled_source_lineage');
    const offer=result.offer;
    if(typeof offer?.sku!=='string'||!offer.sku||
      typeof offer.sourceUrl!=='string'||!offer.sourceUrl)
      return state('MISSING_EVIDENCE','missing_selected_subject');
    const present=now(),observed=parsedTime(ev.observedAt);
    if(!Number.isFinite(present)||!Number.isFinite(observed)||
      observed>present+60_000||present-observed>maxAgeMs)
      return state('EXPIRED','stale_source_head_observation');
    const sourceKey=trustedSourceSubjectKey(ev.sourceId,offer.sku,offer.sourceUrl);
    if(!sourceKey)return state('MISSING_EVIDENCE','invalid_selected_source_identity');
    let accepted;
    try{
      accepted=await store.advanceHead({sourceKey,revision:ev.revision,
        recordId:ev.sourceRecord.recordId,observedAt:ev.observedAt});
    }catch{return state('SOURCE_BLOCKED','source_head_write_failed');}
    if(accepted!==true)
      return state('SUPERSEDED','source_head_rejected_or_conflicted');
    return state('RECORDED','controlled_selected_pdp_head_updated',{
      sourceKey,sourceRevision:ev.revision,observedAt:ev.observedAt});
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
  return Object.freeze({archive,inspect,revoke,recordFreshSource,policyVersion:POLICY});
}
