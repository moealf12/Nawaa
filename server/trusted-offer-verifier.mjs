// Server-only, bounded selected-offer verifier. Not a browser import or a
// general-purpose caller-provided "attestation" evaluator.
// resolveObservation MUST be controlled server acquisition/storage code. It
// must return the selected source record and its observation revision; NEVER
// implement it as a lookup of arbitrary client-supplied evidence JSON.
import {createHash} from 'node:crypto';
import {assessFirstOfferOwnership, structurallyValidOffer} from '../src/search-first-offer-metrics.mjs';

const POLICY='same-offer-v1';
const MAX_AGE_MS=24*60*60*1000;
const ID_KEYS=['sku','modelNumber','gtin'];
const VARIANT_KEYS=['storage','capacity','ram','region','sim','color','edition','condition','bundleContents'];
const IGNORE_QUERY=/^(utm_.+|gclid|fbclid|msclkid|ref|affiliate|aff)$/i;
const scalar=v=>(typeof v==='string'||typeof v==='number') && String(v).trim().length<=256
  ? String(v).trim().toLowerCase() : null;
const id=v=>{const s=scalar(v);return s?s.replace(/[^a-z0-9]/g,''):null;};
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function destination(value){
  if(typeof value!=='string'||value.length>2048)return null;
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||!u.hostname||u.username||u.password)return null;
    const query=[];
    for(const [key,val] of u.searchParams){
      if(IGNORE_QUERY.test(key))continue;
      if(key.length>128||val.length>512)return null;
      query.push([key.toLowerCase(),val]);
    }
    query.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
    u.hash='';
    u.search='';
    for(const [key,val] of query)u.searchParams.append(key,val);
    return u.href;
  }catch{return null;}
}

function claimValue(offer,key){
  if(key==='condition')return scalar(offer?.condition??offer?.specs?.condition);
  const value=offer?.[key]??offer?.variant?.[key]??offer?.specs?.[key];
  if(key==='bundleContents'&&Array.isArray(value)){
    if(value.length>32)return null;
    const parts=value.map(scalar);
    if(parts.some(v=>v===null))return null;
    return parts.sort().join('|');
  }
  return scalar(value);
}

function subject(record,observedAt){
  return {
    observedAt,title:record?.title,productPrice:record?.productPrice,currency:record?.currency,
    merchant:record?.merchant,sourceUrl:record?.sourceUrl,image:record?.image,
    sku:record?.sku,modelNumber:record?.modelNumber,
    gtin:record?.gtin,specs:record?.specs,
    sourceMeta:{productId:record?.sourceMeta?.productId},
    variant:record?.variant,condition:record?.condition,
    storage:record?.storage,capacity:record?.capacity,ram:record?.ram,
    region:record?.region,sim:record?.sim,color:record?.color,
    edition:record?.edition,bundleContents:record?.bundleContents
  };
}

function offerKey(o){
  const identity=ID_KEYS.map(k=>id(k==='modelNumber'?o?.modelNumber??o?.specs?.modelNumber:
    k==='sku'?o?.sku??o?.sourceMeta?.productId:o?.gtin));
  return fingerprint([
    o?.title,o?.productPrice,o?.currency,o?.merchant,o?.observedAt,destination(o?.sourceUrl),
    o?.image||null,identity,VARIANT_KEYS.map(k=>claimValue(o,k))
  ]);
}
function fail(state,reason){return Object.freeze({state,eligible:false,reason,policyVersion:POLICY});}
function compare(offer,observed){
  if(!structurallyValidOffer(offer)||!structurallyValidOffer(observed))
    return 'invalid_selected_record';
  const diagnostic=assessFirstOfferOwnership(offer,observed);
  if(diagnostic.state==='CONFLICTING_EVIDENCE')return diagnostic.reason;
  if(Date.parse(offer.observedAt)!==Date.parse(observed.observedAt))
    return 'observation_time_mismatch';
  if(offer.title!==observed.title||offer.productPrice!==observed.productPrice||
    offer.currency!==observed.currency||offer.merchant!==observed.merchant)
    return 'subject_field_mismatch';
  const left=destination(offer.sourceUrl),right=destination(observed.sourceUrl);
  if(!left||!right||left!==right)return 'destination_selection_mismatch';
  if(offer.image!=null&&
    (typeof offer.image!=='string'||!destination(offer.image)||offer.image!==observed.image))
    return 'image_ownership_mismatch';
  let identityCount=0;
  for(const key of ID_KEYS){
    const a=id(key==='sku'?offer.sku??offer.sourceMeta?.productId:
      key==='modelNumber'?offer.modelNumber??offer.specs?.modelNumber:offer.gtin);
    const b=id(key==='sku'?observed.sku??observed.sourceMeta?.productId:
      key==='modelNumber'?observed.modelNumber??observed.specs?.modelNumber:observed.gtin);
    if(a&&b){if(a!==b)return 'identity_'+key+'_conflict';identityCount++;}
    else if(a||b)return 'identity_'+key+'_missing_evidence';
  }
  if(!identityCount)return 'no_shared_hard_identity';
  for(const key of VARIANT_KEYS){
    const a=claimValue(offer,key),b=claimValue(observed,key);
    if(a!==b)return 'variant_'+key+'_mismatch_or_missing';
  }
  return null;
}

// Only objects issued by THIS verifier instance may be accepted as decisions.
// JSON clones, fabricated identifiers, and decisions from another instance fail.
export function createTrustedOfferVerifier({resolveObservation,now=()=>Date.now(),maxAgeMs=MAX_AGE_MS}={}){
  if(typeof resolveObservation!=='function')throw new TypeError('trusted_resolver_required');
  if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<=0||maxAgeMs>MAX_AGE_MS)
    throw new RangeError('invalid_verification_freshness');
  const issued=new WeakMap();
  async function load(ref){
    if(typeof ref!=='string'||!ref||ref.length>256)return null;
    const evidence=await resolveObservation(ref);
    if(!evidence||evidence.ref!==ref||typeof evidence.revision!=='string'||
       !evidence.revision||evidence.revision.length>256||
       typeof evidence.sourceId!=='string'||!evidence.sourceId||
       typeof evidence.selectedRecord!=='object'||!evidence.selectedRecord||
       Array.isArray(evidence.selectedRecord))return null;
    const time=Date.parse(evidence.observedAt);
    const present=now();
    if(!Number.isFinite(present)||!Number.isFinite(time)||time>present+60_000||
       present-time>maxAgeMs)return null;
    return {evidence,time,present,record:subject(evidence.selectedRecord,evidence.observedAt)};
  }
  async function verify({offer,observationRef}={}){
    if(!structurallyValidOffer(offer))return fail('MISSING_EVIDENCE','invalid_offer');
    let selected;
    try{selected=await load(observationRef);}
    catch{return fail('SOURCE_BLOCKED','observation_load_failed');}
    if(!selected)return fail('MISSING_EVIDENCE','missing_or_stale_source_observation');
    const {evidence,record,time,present}=selected;
    if(offer.providerMarket&&offer.providerMarket!==evidence.sourceId)
      return fail('CONFLICTING_EVIDENCE','merchant_source_mismatch');
    const contradiction=compare(offer,record);
    if(contradiction)return fail(
      /conflict|mismatch/.test(contradiction)?'CONFLICTING_EVIDENCE':'MISSING_EVIDENCE',
      contradiction);
    const digest=fingerprint([observationRef,evidence.sourceId,evidence.revision,
      offerKey(record),time,POLICY]);
    const decision=Object.freeze({
      state:'VERIFIED',eligible:true,policyVersion:POLICY,
      scope:'selected_sellable_offer',observationRef,sourceId:evidence.sourceId,
      evidenceRevision:evidence.revision,evidenceDigest:digest,
      verifiedAt:new Date(present).toISOString(),
      expiresAt:new Date(time+maxAgeMs).toISOString(),
      predicates:Object.freeze({
        identity:'VERIFIED',variant:'VERIFIED',title:'VERIFIED',price:'VERIFIED',
        currency:'VERIFIED',merchant:'VERIFIED',destination:'VERIFIED',
        image:offer.image!=null?'VERIFIED':'NOT_CLAIMED'
      })
    });
    issued.set(decision,{offerDigest:offerKey(offer),evidenceDigest:digest,observationRef});
    return decision;
  }
  // Recheck the authoritative source revision before accepting a decision.
  // A past valid decision cannot certify a newer/altered observation or offer.
  async function accepts(decision,offer,observationRef){
    if(!decision||typeof decision!=='object'||!structurallyValidOffer(offer))return false;
    const saved=issued.get(decision);
    if(!saved||saved.observationRef!==observationRef||
      saved.offerDigest!==offerKey(offer)||decision.state!=='VERIFIED')return false;
    let selected;
    try{selected=await load(observationRef);}catch{return false;}
    if(!selected)return false;
    const {evidence,record,time}=selected;
    if(offer.providerMarket&&offer.providerMarket!==evidence.sourceId)return false;
    if(compare(offer,record)!==null)return false;
    return saved.evidenceDigest===fingerprint([
      observationRef,evidence.sourceId,evidence.revision,offerKey(record),time,POLICY]);
  }
  return Object.freeze({verify,accepts,policyVersion:POLICY});
}
