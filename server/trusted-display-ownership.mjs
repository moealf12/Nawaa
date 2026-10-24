// v21.69: server-only, ephemeral same-offer presentation correlation.
// This layer cannot issue customer badges, T5 milestones, transferable receipts
// or source evidence. It admits ONLY opaque decisions from the existing
// controlled selected-offer verifier. No public route imports this module.
import {createHash,randomUUID} from 'node:crypto';

const GENERATION=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_OFFERS=500;
const MAX_BYTES=64*1024;
// A source verification is NOT a blanket attestation of arbitrary enrichment.
// No aliases, ratings, shipping promises or sourceMeta display names are
// admitted unless explicitly covered by a future predicate-specific verifier.
const VERIFIED_TOP=new Set(['title','productPrice','currency','merchant','providerMarket',
  'sku','mpn','gtin','modelNumber','brand','manufacturer','availability','condition',
  'storage','capacity','ram','region','sim','color','edition','bundleContents',
  'sourceUrl','image','observedAt','variant','specs','sourceMeta']);
const VERIFIED_NESTED={
  variant:new Set(['storage','capacity','ram','region','sim','color','edition',
    'condition','bundleContents']),
  specs:new Set(['brand','modelNumber','color','storage','capacity','ram',
    'region','sim','condition','gtin','mpn']),
  sourceMeta:new Set(['productId'])
};
function admissionFields(offer){
  if(!offer||typeof offer!=='object'||Array.isArray(offer))return false;
  try{
    for(const key of Object.keys(offer)){
      if(!VERIFIED_TOP.has(key))return false;
      if(Object.hasOwn(VERIFIED_NESTED,key)){
        const object=offer[key];
        if(!object||typeof object!=='object'||Array.isArray(object)||
           !Object.keys(object).every(k=>VERIFIED_NESTED[key].has(k)))return false;
      }
    }
    return true;
  }catch{return false;}
}
function strictDigest(offer){
  if(!offer||typeof offer!=='object'||Array.isArray(offer))return null;
  // Canonicalize complete display-relevant offer graph, not just SKU or URL.
  // Reject functions, cycles, oversized, excessive nesting, unsafe numbers,
  // accessors and exotic prototype objects rather than dropping fields.
  let nodes=0;
  const seen=new WeakSet();
  function clean(value,depth=0){
    if(depth>8||++nodes>2048)throw Error('offer_graph_budget');
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number'){
      if(!Number.isFinite(value)||!Number.isSafeInteger(value*100))throw Error('invalid_offer_number');
      return value;
    }
    if(typeof value==='string'){
      if(value.length>8192)throw Error('long_offer_field');
      return value;
    }
    if(!value||typeof value!=='object'||seen.has(value))throw Error('invalid_offer_graph');
    if(Array.isArray(value)){
      if(value.length>256)throw Error('oversized_offer_array');
    }else{
      const proto=Object.getPrototypeOf(value);
      if(proto!==Object.prototype&&proto!==null)throw Error('exotic_offer_prototype');
    }
    seen.add(value);
    const result=Array.isArray(value)?[]:{};
    const keys=Object.keys(value).sort();
    if(keys.length>256)throw Error('oversized_offer_object');
    for(const key of keys){
      if(key==='__proto__'||key==='constructor'||key==='prototype')throw Error('unsafe_offer_key');
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('offer_accessor_forbidden');
      const val=descriptor.value;
      if(val===undefined||typeof val==='function'||typeof val==='bigint'||
         typeof val==='symbol')throw Error('non_serializable_offer');
      result[key]=clean(val,depth+1);
    }
    seen.delete(value);
    return result;
  }
  try{
    const serialized=JSON.stringify(clean(offer));
    if(!serialized||Buffer.byteLength(serialized)>MAX_BYTES)return null;
    return createHash('sha256').update(serialized).digest('hex');
  }catch{return null;}
}
const denied=(reason)=>Object.freeze({state:'DENIED',reason,badgeEligible:false,
  customerVerified:false,t5Eligible:false});

export function createTrustedDisplayOwnership({verifier,streamGeneration=randomUUID()}={}){
  if(!verifier||typeof verifier.accepts!=='function'||
     typeof streamGeneration!=='string'||!GENERATION.test(streamGeneration))
    throw TypeError('controlled_display_verifier_or_generation_required');
  const issued=new WeakMap();
  let revision=0;
  let activeDigests=new Set();
  let disabled=false;
  // TRUSTED SERVER CALLER ONLY: feeds the actual canonical outbound snapshot.
  // A completely empty snapshot invalidates all previous offer bindings.
  function advance(snapshotRevision,offers){
    if(disabled)return false;
    if(!Number.isSafeInteger(snapshotRevision)||snapshotRevision<=revision||
       !Array.isArray(offers)||offers.length>MAX_OFFERS) return false;
    const next=new Set();
    for(const offer of offers){
      const digest=strictDigest(offer);
      if(!digest)return false;
      next.add(digest);
    }
    revision=snapshotRevision;
    activeDigests=next;
    return true;
  }
  async function bind({decision,offer,observationRef,displayOffer,
    streamGeneration:incoming,snapshotRevision,renderEpoch}={}){
    if(disabled||incoming!==streamGeneration||
       !Number.isSafeInteger(snapshotRevision)||snapshotRevision!==revision||
       !Number.isSafeInteger(renderEpoch)||renderEpoch<=0)
      return denied('stale_or_invalid_display_context');
    if(!admissionFields(offer)||!admissionFields(displayOffer))
      return denied('unverified_presentation_field');
    const sourceDigest=strictDigest(offer);
    const displayDigest=strictDigest(displayOffer);
    if(!sourceDigest||sourceDigest!==displayDigest||
       !activeDigests.has(displayDigest))return denied('display_offer_ownership_mismatch');
    if(!decision||decision.state!=='VERIFIED'||decision.eligible!==true||
       decision.scope!=='selected_sellable_offer'||
       typeof decision.evidenceRevision!=='string'||!decision.evidenceRevision||
       decision.observationRef!==observationRef)
      return denied('missing_whole_offer_verifier_decision');
    let accepted=false;
    try{accepted=await verifier.accepts(decision,offer,observationRef);}
    catch{return denied('source_revalidation_failed');}
    if(!accepted)return denied('source_decision_invalidated');
    // No customer authority is serialized; an opaque in-process object is
    // used solely to assert cross-field ownership across future rechecks.
    const result=Object.freeze({state:'BOUND_INTERNAL',scope:'same_display_offer',
      streamGeneration,snapshotRevision,renderEpoch,
      evidenceRevision:decision.evidenceRevision,
      badgeEligible:false,customerVerified:false,t5Eligible:false});
    issued.set(result,{decision,offer,observationRef,displayDigest,
      snapshotRevision,renderEpoch});
    return result;
  }
  async function accepts(bound,{displayOffer,streamGeneration:incoming,
    snapshotRevision,renderEpoch}={}){
    if(disabled||!bound||typeof bound!=='object'||incoming!==streamGeneration||
       revision!==snapshotRevision||!Number.isSafeInteger(renderEpoch)||
       renderEpoch<=0)return false;
    const original=issued.get(bound);
    if(!original||original.snapshotRevision!==snapshotRevision||
       original.renderEpoch!==renderEpoch||
       !admissionFields(displayOffer)||
       original.displayDigest!==strictDigest(displayOffer)||
       !activeDigests.has(original.displayDigest))return false;
    try{return await verifier.accepts(original.decision,original.offer,original.observationRef);}
    catch{return false;}
  }
  function revoke(){disabled=true;activeDigests=new Set();revision=0;}
  return Object.freeze({streamGeneration,advance,bind,accepts,revoke,
    get currentSnapshotRevision(){return revision;}});
}
