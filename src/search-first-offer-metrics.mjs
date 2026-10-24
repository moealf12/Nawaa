// Pure, diagnostic-only first-offer classification shared by the server and
// isolated HTTP timing harness. Does not modify, sort or filter actual offers.
export function structurallyValidOffer(offer) {
  return offer && typeof offer.title === 'string' && offer.title.trim().length > 0 &&
    Number.isFinite(offer.productPrice) && offer.productPrice > 0 &&
    offer.currency === 'SAR' &&
    typeof offer.merchant === 'string' && offer.merchant.trim().length > 0 &&
    offer.merchant !== 'App' &&
    Boolean(safeHttpsUrl(offer.sourceUrl)) &&
    typeof offer.observedAt === 'string' && Number.isFinite(Date.parse(offer.observedAt));
}

export function firstOfferMilestones(offers = []) {
  let firstValid = null, firstExact = null, validCount = 0, exactCount = 0;
  for (const offer of Array.isArray(offers) ? offers : []) {
    if (!structurallyValidOffer(offer)) continue;
    validCount++;
    if (firstValid === null) firstValid = offer;
    if (offer.exactMatch === true) {
      exactCount++;
      if (firstExact === null) firstExact = offer;
    }
  }
  return {firstValid,firstExact,validCount,exactCount};
}


// v21.57: diagnostic-only evidence boundary. Structural validity, exact-match
// ranking and same-sellable-item ownership are separate assertions. A browser
// timing sample must never promote an inferred match to VERIFIED.
export const OFFER_OWNERSHIP_STATES=Object.freeze([
  'VERIFIED','CONSISTENT_BUT_UNVERIFIED','MISSING_EVIDENCE',
  'CONFLICTING_EVIDENCE','SOURCE_BLOCKED'
]);

function safeHttpsUrl(value){
  if(typeof value!=='string')return null;
  try{
    const u=new URL(value);
    return u.protocol==='https:'&&u.hostname&&
      !u.username&&!u.password?u:null;
  }catch{return null;}
}
// Different selected variants may share a merchant pathname and differ only
// by identity-bearing query parameters. Tracking parameters are not identity.
function conflictingVariantQuery(a,b){
  const keys=new Set(['sku','variant','variantid','productid','model','storage','capacity','color','size']);
  const params=url=>{
    const out=new Map();
    for(const [key,value] of url.searchParams){
      const normalizedKey=key.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(keys.has(normalizedKey)&&value.trim()){
        if(!out.has(normalizedKey))out.set(normalizedKey,new Set());
        out.get(normalizedKey).add(value.trim().toLowerCase());
      }
    }
    return out;
  };
  const left=params(a),right=params(b);
  for(const [key,values] of left){
    if(right.has(key)){
      const other=right.get(key);
      if(values.size!==other.size||[...values].some(v=>!other.has(v)))return true;
    }
  }
  return false;
}
function canonicalId(value){
  return typeof value==='string'||typeof value==='number'?
    String(value).trim().toLowerCase().replace(/[^a-z0-9]/g,''):null;
}
function ownedIdentity(offer){
  const specs=offer?.specs||{};
  return {
    sku:canonicalId(offer?.sku??offer?.sourceMeta?.productId),
    model:canonicalId(offer?.modelNumber??specs.modelNumber),
    gtin:canonicalId(offer?.gtin),
  };
}
export function assessFirstOfferOwnership(offer,evidence=null){
  const fields=['title','price','currency','merchant','sourceUrl','image','identity'];
  const result={state:'MISSING_EVIDENCE',eligible:false,
    reason:'missing_independent_same_offer_evidence',
    fields:Object.fromEntries(fields.map(k=>[k,'MISSING_EVIDENCE']))};
  if(!structurallyValidOffer(offer)){
    return {...result,reason:'structurally_invalid_offer'};
  }
  result.fields.title='CONSISTENT_BUT_UNVERIFIED';
  result.fields.price='CONSISTENT_BUT_UNVERIFIED';
  result.fields.currency='CONSISTENT_BUT_UNVERIFIED';
  result.fields.merchant='CONSISTENT_BUT_UNVERIFIED';
  result.fields.sourceUrl='CONSISTENT_BUT_UNVERIFIED';
  result.fields.image=offer.image?'CONSISTENT_BUT_UNVERIFIED':'MISSING_EVIDENCE';
  const identity=ownedIdentity(offer);
  result.fields.identity=Object.values(identity).some(Boolean)?
    'CONSISTENT_BUT_UNVERIFIED':'MISSING_EVIDENCE';
  if(evidence?.sourceBlocked===true){
    return {...result,state:'SOURCE_BLOCKED',reason:'source_blocked'};
  }
  if(evidence?.crossFieldConflict===true){
    return {...result,state:'CONFLICTING_EVIDENCE',reason:'explicit_cross_field_conflict'};
  }
  if(!evidence||typeof evidence!=='object'){
    return {...result,state:'CONSISTENT_BUT_UNVERIFIED'};
  }
  const destination=safeHttpsUrl(offer.sourceUrl);
  const evidenceDestination=safeHttpsUrl(evidence.sourceUrl);
  const priced=evidence.productPrice===offer.productPrice&&
    evidence.currency===offer.currency;
  const merchant=evidence.merchant===offer.merchant;
  const ids=ownedIdentity(evidence);
  let shared=false;
  for(const key of Object.keys(identity)){
    if(identity[key]&&ids[key]){
      if(identity[key]!==ids[key]){
        return {...result,state:'CONFLICTING_EVIDENCE',reason:'identity_conflict_'+key};
      }
      shared=true;
    }
  }
  if(destination&&evidenceDestination&&
     destination.origin+destination.pathname!==
     evidenceDestination.origin+evidenceDestination.pathname){
    return {...result,state:'CONFLICTING_EVIDENCE',reason:'destination_conflict'};
  }
  if(destination&&evidenceDestination&&conflictingVariantQuery(destination,evidenceDestination)){
    return {...result,state:'CONFLICTING_EVIDENCE',reason:'destination_variant_conflict'};
  }
  if(evidence.productPrice!=null&&evidence.currency!=null&&!priced){
    return {...result,state:'CONFLICTING_EVIDENCE',reason:'price_currency_conflict'};
  }
  if(evidence.merchant!=null&&!merchant){
    return {...result,state:'CONFLICTING_EVIDENCE',reason:'merchant_conflict'};
  }
  if(offer.image&&evidence.image!=null&&evidence.image!==offer.image){
    return {...result,state:'CONFLICTING_EVIDENCE',reason:'image_conflict'};
  }
  const coherent=shared&&priced&&merchant&&destination&&evidenceDestination&&
    evidence.title===offer.title;
  if(!coherent){
    return {...result,state:'CONSISTENT_BUT_UNVERIFIED',
      reason:'incomplete_same_offer_evidence'};
  }
  // v21.60: evidence here is ordinary caller-supplied data, not a trusted
  // verifier's issued proof. A self-asserted independentlyAttested flag (or a
  // byte-for-byte clone of the offer) cannot grant VERIFIED or T5 eligibility.
  // Fail closed until a controlled verifier with inspectable origin is wired.
  return {...result,state:'CONSISTENT_BUT_UNVERIFIED',
    reason:evidence.independentlyAttested===true?
      'untrusted_attestation_claim':'trusted_attestation_unavailable'};
}

export function firstOwnershipEligibleOffer(offers,evidenceForOffer=()=>null){
  if(!Array.isArray(offers))return null;
  for(const offer of offers){
    const ownership=assessFirstOfferOwnership(offer,evidenceForOffer(offer));
    if(ownership.eligible)return {offer,ownership};
  }
  return null;
}


// Per-search, monotonic diagnostic clock. DOM commitment is not a paint event;
// a browser observation may report visibility without claiming compositor proof.
export function createFirstOfferTimeline(requestId,clock=()=>performance.now()){
  const startedAt=clock();
  const milestones={T0:startedAt};
  let terminal=null;
  const validNames=new Set(['T1','T2','T3','T4','T5','T6','T7','T8']);
  return {
    mark(name,{requestId:incoming=requestId,ownership=null,evidence=null}={}){
      if(terminal||incoming!==requestId||!validNames.has(name)||milestones[name]!=null)
        return false;
      if(name==='T5'&&ownership?.eligible!==true)return false;
      if((name==='T6'||name==='T7'||name==='T8')&&milestones.T5==null)return false;
      if(name==='T8'&&evidence?.independentlyObserved!==true)return false;
      const now=clock();
      if(!Number.isFinite(now)||now<startedAt||
         now<Math.max(...Object.values(milestones)))return false;
      milestones[name]=now;
      return true;
    },
    finish(status){
      if(terminal)return false;
      if(!['complete','cancelled','failed','empty','partial','timed_out'].includes(status))
        return false;
      terminal=status;
      return true;
    },
    snapshot(){
      return {requestId,status:terminal||'pending',
        milestones:{...milestones},
        elapsedMs:Object.fromEntries(Object.entries(milestones)
          .map(([name,value])=>[name,value-startedAt])),
        firstVisibleCertified:milestones.T8!=null,
        limitations:['DOM_commit_is_not_paint',
          'independent_browser_observation_requires_external_evidence']};
    }
  };
}
