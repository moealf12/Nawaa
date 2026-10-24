// v21.68: bounded server-side selected-PDP refresh orchestration.
// It never trusts caller-supplied flags and never grants customer badges/T5.
// Selected source observation and signing authority remain with existing
// createPdpObservationSession / createTrustedObservationJournal.
import {createPdpObservationSession} from './trusted-pdp-observation.mjs';

const REFRESH_TIMEOUT=12_000;
const fail=(state,reason)=>Object.freeze({state,reason,eligible:false,
  wholeOfferVerified:false,badgeEligible:false,firstTrustworthyOfferEligible:false});
export function createControlledPdpRefresh({
  journal,createSession=()=>createPdpObservationSession(),
  timeoutMs=REFRESH_TIMEOUT,now=()=>Date.now()
}={}){
  if(!journal||typeof journal.recordFreshSource!=='function'||
    typeof journal.archive!=='function'||
    typeof createSession!=='function'||typeof now!=='function')
    throw TypeError('controlled_pdp_refresh_dependencies_required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>REFRESH_TIMEOUT)
    throw RangeError('invalid_pdp_refresh_timeout');
  async function refresh(candidate,{signal,archive=false}={}){
    if(signal?.aborted)return fail('SOURCE_BLOCKED','cancelled');
    // The candidate only locates a merchant PDP. None of its fields or flags
    // authorize verification; the original opaque verifier must issue proof.
    if(!candidate||candidate.providerMarket!=='jarir-sa'||
      candidate.merchant!=='Jarir'||typeof candidate.sourceUrl!=='string')
      return fail('MISSING_EVIDENCE','unsupported_selected_source');
    const controller=new AbortController();
    const timeout=AbortSignal.timeout(timeoutMs);
    const cancel=()=>controller.abort();
    if(signal)signal.addEventListener('abort',cancel,{once:true});
    timeout.addEventListener('abort',cancel,{once:true});
    const started=now();
    try{
      if(controller.signal.aborted)return fail('SOURCE_BLOCKED','cancelled');
      const session=createSession();
      if(!session||typeof session.verifySelectedRevision!=='function'||
        typeof session.accepts!=='function')
        return fail('SOURCE_BLOCKED','invalid_controlled_verifier');
      let selected;
      try{selected=await session.verifySelectedRevision(candidate,{signal:controller.signal})}
      catch{return fail('SOURCE_BLOCKED','selected_pdp_observation_failed')}
      if(controller.signal.aborted)return fail('SOURCE_BLOCKED','cancelled');
      if(selected?.state!=='VERIFIED'||!await session.accepts(selected))
        return fail(selected?.state||'MISSING_EVIDENCE',
          selected?.reason||'selected_source_unverified');
      // A valid source revision may supersede a previous one. A failed
      // source write never authorizes the client to claim any trust milestone.
      const recorded=await journal.recordFreshSource(selected);
      if(controller.signal.aborted)return fail('SOURCE_BLOCKED','cancelled');
      if(recorded?.state!=='RECORDED')
        return fail(recorded?.state||'SOURCE_BLOCKED',
          recorded?.reason||'source_head_not_updated');
      let archived=null;
      if(archive){
        archived=await journal.archive(selected);
        if(controller.signal.aborted)return fail('SOURCE_BLOCKED','cancelled');
        if(archived?.state!=='ARCHIVED')
          return fail(archived?.state||'SOURCE_BLOCKED',
            archived?.reason||'source_receipt_not_archived');
      }
      const evidence=typeof session.evidence==='function'?
        session.evidence(selected.observationRef):null;
      return Object.freeze({state:'RECORDED',reason:'controlled_selected_source_observed',
        sourceId:'jarir-sa',sourceRevision:recorded.sourceRevision,
        sourceObservedAt:evidence?.observedAt??null,
        selectedRecord:evidence?.sourceRecord??null,
        selectedOffer:selected.offer,
        verifiedPredicates:selected.decision.predicates,
        historicalClaims:selected.historicalClaims,
        durationMs:Math.max(0,now()-started),
        receiptRef:archived?.receiptRef??null,
        eligible:false,wholeOfferVerified:false,badgeEligible:false,
        firstTrustworthyOfferEligible:false});
    }finally{
      if(signal)signal.removeEventListener('abort',cancel);
      timeout.removeEventListener('abort',cancel);
    }
  }
  return Object.freeze({refresh});
}
