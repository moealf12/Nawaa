// v21.70: bounded bridge from ORIGINAL issued merchant PDP evidence to a
// single immutable outbound search frame. Predicate scope only: never a
// customer-facing VERIFIED grant. No customer API or auto-refresh is created.
import {randomUUID} from 'node:crypto';
import {createPdpObservationSession,inspectIssuedPdpReceipt} from './trusted-pdp-observation.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_OFFERS=500;
const MAX_OFFER_BYTES=32*1024;
const fail=(reason)=>Object.freeze({state:'DENIED',reason,
  sourcePredicatesRevalidated:false,wholeOfferVerified:false,
  badgeEligible:false,customerVerified:false,t5Eligible:false});
function serializeOffer(value){
  try{
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    const json=JSON.stringify(value);
    if(!json||Buffer.byteLength(json)>MAX_OFFER_BYTES)return null;
    // JSON rejects NaN only by converting it to null: prohibit lossy grants.
    const parsed=JSON.parse(json);
    if(!parsed||!Number.isFinite(parsed.productPrice)||parsed.productPrice<=0||
       typeof parsed.title!=='string'||!parsed.title||
       typeof parsed.sourceUrl!=='string'||!parsed.sourceUrl)return null;
    return json;
  }catch{return null;}
}
export function createTrustedPdpStreamBridge({
  journal,createSession=()=>createPdpObservationSession(),
  streamGeneration=randomUUID()
}={}){
  if(!journal||typeof journal.recordFreshSource!=='function'||
     typeof journal.archive!=='function'||typeof journal.inspect!=='function'||
     typeof createSession!=='function'||!UUID.test(streamGeneration))
    throw TypeError('trusted_pdp_stream_dependencies_required');
  const issued=new WeakMap();
  let lastRevision=0;
  let revoked=false;

  async function observe(candidate,{signal}={}){
    if(revoked||signal?.aborted)return fail('cancelled_or_revoked');
    const session=createSession();
    if(!session||typeof session.verifySelectedRevision!=='function'||
       typeof session.accepts!=='function')return fail('invalid_source_session');
    let selected;
    try{selected=await session.verifySelectedRevision(candidate,{signal});}
    catch{return fail('selected_source_unavailable');}
    if(revoked||signal?.aborted)return fail('cancelled_or_revoked');
    if(selected?.state!=='VERIFIED'||
       selected.certificateScope!=='selected_pdp_revision_predicates'||
       selected.wholeOfferVerified!==false||selected.badgeEligible!==false)
      return fail(selected?.reason||'unsupported_or_unverified_pdp');
    // The private WeakMap from the actual source issuance module defeats
    // duck-typed or caller-injected VERIFY status objects.
    const source=await inspectIssuedPdpReceipt(selected);
    if(!source)return fail('not_an_original_source_issuance');
    if(!await session.accepts(selected,selected.offer))
      return fail('source_issuance_invalidated');
    const recorded=await journal.recordFreshSource(selected);
    if(revoked||signal?.aborted)return fail('cancelled_or_revoked');
    if(recorded?.state!=='RECORDED')
      return fail(recorded?.reason||'latest_source_head_rejected');
    const archive=await journal.archive(selected);
    if(revoked||signal?.aborted)return fail('cancelled_or_revoked');
    if(archive?.state!=='ARCHIVED')return fail(archive?.reason||'source_receipt_missing');
    const reviewed=await journal.inspect(archive.receiptRef,{expectedOffer:selected.offer});
    if(revoked||signal?.aborted)return fail('cancelled_or_revoked');
    if(reviewed?.state!=='REVALIDATED'||
       reviewed.sourceRevision!==recorded.sourceRevision||
       reviewed.scope!=='selected_pdp_revision_predicates')
      return fail(reviewed?.reason||'source_head_not_current');
    const reference=Object.freeze({state:'STAGED_SOURCE_PREDICATES',
      sourceRevision:reviewed.sourceRevision,sourceId:reviewed.sourceId,
      sourceRecordId:reviewed.sourceRecord?.recordId??null,
      sourcePredicatesRevalidated:true,wholeOfferVerified:false,
      badgeEligible:false,customerVerified:false,t5Eligible:false});
    issued.set(reference,{session,selected,receiptRef:archive.receiptRef,
      serial:serializeOffer(selected.offer),revision:reviewed.sourceRevision});
    return reference;
  }

  async function bind(prepared,{streamGeneration:incoming,snapshotRevision,
    renderEpoch,offers,offerIndex,signal}={}){
    if(revoked||signal?.aborted)return fail('revoked_or_cancelled');
    const record=issued.get(prepared);
    if(!record||incoming!==streamGeneration||
       !Number.isSafeInteger(snapshotRevision)||snapshotRevision<=lastRevision||
       !Number.isSafeInteger(renderEpoch)||renderEpoch<1||
       !Array.isArray(offers)||offers.length<1||offers.length>MAX_OFFERS||
       !Number.isSafeInteger(offerIndex)||offerIndex<0||offerIndex>=offers.length)
      return fail('unowned_or_invalid_snapshot');
    // Exact serialized content equality is deliberately conservative:
    // enrichment, re-ranking or canonical rewriting can never borrow the PDP
    // receipt even if price, title or SKU still happen to match.
    const serialized=serializeOffer(offers[offerIndex]);
    if(!record.serial||serialized!==record.serial||
       offers.filter(o=>serializeOffer(o)===serialized).length!==1)
      return fail('offer_content_not_uniquely_owned_by_source');
    // Consume this revision before async checks to close duplicate races.
    lastRevision=snapshotRevision;
    let current,accepted,issuedSource;
    try{
      [current,accepted,issuedSource]=await Promise.all([
        journal.inspect(record.receiptRef,{expectedOffer:offers[offerIndex]}),
        record.session.accepts(record.selected,offers[offerIndex]),
        inspectIssuedPdpReceipt(record.selected)
      ]);
    }catch{return fail('source_revalidation_unavailable');}
    if(revoked||signal?.aborted||lastRevision!==snapshotRevision)
      return fail('stream_superseded_during_revalidation');
    if(!accepted||!issuedSource||current?.state!=='REVALIDATED'||
       current.sourceRevision!==record.revision||
       current.scope!=='selected_pdp_revision_predicates')
      return fail(current?.reason||'source_evidence_not_current');
    // This can be used as a scoped source annotation in a future publisher.
    // It is NOT signed customer proof, cannot authorize a badge or T5 and must
    // never be confused with an actual browser render certificate.
    return Object.freeze({state:'SOURCE_PREDICATES_BOUND',
      scope:'selected_pdp_revision_predicates',
      streamGeneration,snapshotRevision,renderEpoch,
      sourceId:current.sourceId,sourceRevision:current.sourceRevision,
      sourceRecordId:current.sourceRecord?.recordId??null,
      sourcePredicatesRevalidated:true,wholeOfferVerified:false,
      badgeEligible:false,customerVerified:false,t5Eligible:false});
  }
  function revoke(){revoked=true;lastRevision=Number.MAX_SAFE_INTEGER;}
  return Object.freeze({observe,bind,revoke,streamGeneration});
}
