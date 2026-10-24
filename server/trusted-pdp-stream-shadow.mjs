// v21.71: optional PASSIVE shadow lane on actual search SSE frames.
// It cannot issue customer VERIFIED, modify search offers, alter ranking,
// or delay any first-offer frame. Default OFF. The per-stream receipt store
// is deliberately ephemeral and NEVER a durable cross-process certificate.
import {createTrustedPdpStreamBridge} from './trusted-pdp-stream-bridge.mjs';
import {createTrustedObservationJournal} from './trusted-observation-journal.mjs';
import {trustedJournalKeyringFromEnv} from './trusted-journal-keyring.mjs';

const MAX_PROBE_MS=2500;
const GLOBAL_COOLDOWN_MS=30_000;
let activeProbe=false,lastAllowedAt=0;
const nonTrust='selected_pdp_revision_predicates';
const isJarir=o=>o&&o.merchant==='Jarir'&&o.providerMarket==='jarir-sa'&&
  typeof o.sourceUrl==='string'&&o.sourceUrl.startsWith('https://');
function transientStore(){
  // One stream, one controlled PDP candidate, no persistence or third-party
  // secrets in the receipt. Equal-time conflicts invalidate head evidence.
  const rows=[],heads=new Map();
  function advance(b){
    const prev=heads.get(b.sourceKey);
    if(prev){
      if(Date.parse(b.observedAt)<Date.parse(prev.observedAt))return false;
      if(Date.parse(b.observedAt)===Date.parse(prev.observedAt)){
        if(prev.conflicted||prev.revision!==b.revision||prev.recordId!==b.recordId){
          heads.set(b.sourceKey,{...prev,conflicted:true});return false;
        }
        return true;
      }
    }
    heads.set(b.sourceKey,{...b,conflicted:false});return true;
  }
  return Object.freeze({
    append:async e=>{rows.push(e);},
    events:async ref=>rows.filter(e=>e.ref===ref),
    currentHead:async key=>heads.get(key)||null,
    appendCapture:async(e,b)=>{if(!advance(b))return false;rows.push(e);return true;},
    advanceHead:async b=>advance(b)
  });
}
const safeEvent=bound=>Object.freeze({
  policy:'pdp-predicate-shadow-v1',scope:nonTrust,
  streamGeneration:bound.streamGeneration,snapshotRevision:bound.snapshotRevision,
  sourceId:bound.sourceId,sourceRevision:bound.sourceRevision,
  sourceRecordId:bound.sourceRecordId,offerIndex:bound.offerIndex,
  sourcePredicatesRevalidated:true,
  wholeOfferVerified:false,badgeEligible:false,customerVerified:false,
  t5Eligible:false,paintCertified:false,durableProof:false
});
export function createPdpStreamShadow({
  journal,createSession,streamGeneration,signal,sendEvent,mayAcquire=()=>true,
  timeoutMs=MAX_PROBE_MS
}={}){
  if(!journal||typeof journal.inspect!=='function'||typeof sendEvent!=='function'||
     !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>MAX_PROBE_MS)
    throw TypeError('invalid_shadow_stream_dependencies');
  const bridge=createTrustedPdpStreamBridge({journal,createSession,streamGeneration});
  let frame=null,revision=0,started=false,closed=false,pending=null,clock=null;
  const control=new AbortController();
  const cancel=()=>close();
  signal?.addEventListener('abort',cancel,{once:true});
  if(signal?.aborted)cancel();
  function close(){
    if(closed)return;
    closed=true;control.abort();bridge.revoke();
    if(clock!==null)clearTimeout(clock);
    signal?.removeEventListener('abort',cancel);
  }
  function consider(snapshot,snapshotRevision){
    if(closed||!Number.isSafeInteger(snapshotRevision)||snapshotRevision<=revision||
       !snapshot||!Array.isArray(snapshot.offers))return;
    revision=snapshotRevision;
    frame=snapshot;
    if(started)return;
    const candidate=snapshot.offers.find(isJarir);
    if(!candidate||!mayAcquire())return;
    started=true;
    clock=setTimeout(()=>control.abort(),timeoutMs);
    // Never await this source acquisition from the actual SSE publisher.
    pending=(async()=>{
      try{
        const prepared=await bridge.observe(candidate,{signal:control.signal});
        if(closed||control.signal.aborted||
           prepared.state!=='STAGED_SOURCE_PREDICATES')return;
        const selected=JSON.stringify(prepared.selectedOffer);
        const latest=frame,latestRevision=revision;
        const matches=latest.offers.map((offer,i)=>JSON.stringify(offer)===selected?i:-1)
          .filter(i=>i>=0);
        if(matches.length!==1)return;
        if(!bridge.beginRender(latestRevision))return;
        const bound=await bridge.bind(prepared,{
          streamGeneration,snapshotRevision:latestRevision,
          renderEpoch:latestRevision,offers:latest.offers,offerIndex:matches[0],
          signal:control.signal
        });
        if(bound.state!=='SOURCE_PREDICATES_BOUND'||closed||
           control.signal.aborted||revision!==latestRevision)return;
        // An extra diagnostic SSE event. Browsers never treat this as badge
        // evidence, and the original offers/snapshot are not rewritten.
        sendEvent('source-predicate',safeEvent({...bound,offerIndex:matches[0]}));
      }catch{
        // Source is blocked, inconsistent, timed out or missing: no event.
      }finally{
        if(clock!==null){clearTimeout(clock);clock=null;}
      }
    })();
  }
  return Object.freeze({consider,close,whenSettled:()=>pending||Promise.resolve(),
    get started(){return started;}});
}
export function configuredPdpStreamShadow({streamGeneration,signal,sendEvent,env=process.env}={}){
  if(env.NAWAA_TRUST_PDP_SSE_SHADOW!=='1')return null;
  if(activeProbe||Date.now()-lastAllowedAt<GLOBAL_COOLDOWN_MS)return null;
  let keyring;
  try{keyring=trustedJournalKeyringFromEnv(env);}
  catch{return null;} // no keys => absolutely no PDP source fetch.
  // Never use synthetic keys, a public API flag, or a DB-less local receipt
  // as cross-process authority. This is only an opt-in diagnostic.
  const journal=createTrustedObservationJournal({store:transientStore(),keyring,
    requireCurrentHead:true});
  let acquired=false,released=false;
  const tryAcquire=()=>{
    if(acquired||activeProbe||Date.now()-lastAllowedAt<GLOBAL_COOLDOWN_MS)return false;
    activeProbe=true;acquired=true;lastAllowedAt=Date.now();return true;
  };
  const release=()=>{if(!released&&acquired){released=true;activeProbe=false;}};
  const originalSend=sendEvent;
  let shadow;
  try{
    shadow=createPdpStreamShadow({journal,streamGeneration,signal,mayAcquire:tryAcquire,
      sendEvent:(event,data)=>{if(!signal?.aborted)originalSend(event,data);}});
  }catch{release();return null;}
  const close=()=>{
    shadow.close();
    release();
  };
  const consider=(snapshot,rev)=>{
    shadow.consider(snapshot,rev);
    if(shadow.started){
      void shadow.whenSettled().finally(release);
    }
  };
  return Object.freeze({consider,close});
}
