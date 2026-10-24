// Server-only PDP observation binding. Verification is never minted from an
// inbound evidence object, cached listing, UI flag, or a second parser of one
// seller record. Live acquisition uses the existing SSRF-hardened resolver.
import {createHash,randomUUID} from 'node:crypto';
import {resolveSelectedJsonLdOffer} from './url-resolver.mjs';
import {createTrustedOfferVerifier} from './trusted-offer-verifier.mjs';

const SOURCE_ID='jarir-sa';
const HOST='jarir.com';
const MAX_CAPTURE_AGE_MS=5*60*1000;
const MAX_RECORDS=32;
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function target(value){
  if(typeof value!=='string'||value.length>2048)return null;
  try{
    const u=new URL(value);
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    if(u.protocol!=='https:'||host!==HOST||u.username||u.password||
       (u.port&&u.port!=='443'))return null;
    return u;
  }catch{return null;}
}
function selectedDestination(request,actual){
  const a=target(request),b=target(actual);
  if(!a||!b||a.pathname.replace(/\/+$/,'')!==b.pathname.replace(/\/+$/,''))return false;
  const selectors=new Set(['sku','variant','variantid','productid','optionid','model','storage','capacity','color','size']);
  const fields=url=>{
    const map=new Map();
    for(const [key,value] of url.searchParams){
      const k=key.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(!selectors.has(k))continue;
      if(map.has(k)&&map.get(k)!==value.toLowerCase())return null;
      map.set(k,value.toLowerCase());
    }
    return map;
  };
  const x=fields(a),y=fields(b);
  if(!x||!y)return false;
  for(const [key,value] of x)if(y.get(key)!==value)return false;
  for(const [key,value] of y)if(x.has(key)&&x.get(key)!==value)return false;
  return true;
}
function originKey(v){
  return v&&typeof v.strategy==='string'&&v.strategy!=='none'?
    v.strategy+':'+(v.adapterId||''):null;
}
function sameRecordProvenance(page,offer){
  const e=page?.extraction;
  // A field strategy is not a unique product record identifier: two
  // adjacent JSON-LD Product nodes can BOTH have strategy="jsonld".
  // Certify only one unambiguous selected Product+Offer until the extractor
  // exports immutable per-record ownership identifiers.
  const selected=e?.selectedProductRecord;
  // Only an explicitly selected Product+single Offer is admissible.
  // Strategy labels alone cannot identify source records or prove ownership.
  if(!selected||selected.source!=='jsonld_product_offer'||
     !/^[0-9a-f]{64}$/.test(selected.recordId||'')||
     !/^[0-9a-f]{64}$/.test(selected.documentDigest||'')||
     selected.selectedCount!==1||
     !selectedDestination(page.resolvedPageUrl,selected.selectedProductUrl)||
     !selectedDestination(page.resolvedPageUrl,selected.selectedOfferUrl))
    return 'missing_selected_product_record_proof';
  if(!e||e.conflictSummary?.hasConflicts!==false||
     e.reconciled!==false||
     e.identity?.summary?.accepted!==1||
     e.identity?.summary?.rejected!==0||
     !Array.isArray(e.availableStrategies)||
     e.availableStrategies.length!==1||
     e.availableStrategies[0]!=='jsonld')
    return 'ambiguous_product_reconciliation';
  if(page.originalCurrency!=='SAR'||page.currency!=='SAR'||
    page.originalProductPrice!==page.productPrice)
    return 'unverified_price_currency_pair';
  const fields=e.fieldSources;
  if(!fields||typeof fields!=='object')return 'missing_field_provenance';
  const anchor=originKey(fields.offers);
  if(!anchor||anchor=== 'meta:')return 'missing_priced_record_origin';
  const required=['name'];
  // Only claims present in the candidate require field-level ownership.
  if(offer.image!=null)required.push('image');
  if(offer.sku!=null||offer.sourceMeta?.productId!=null)required.push('sku');
  if(offer.modelNumber!=null||offer.specs?.modelNumber!=null||offer.mpn!=null)required.push('mpn');
  if(offer.gtin!=null)required.push('gtin');
  if(offer.brand!=null||offer.specs?.brand!=null)required.push('brand');
  if(offer.color!=null||offer.specs?.color!=null)required.push('color');
  for(const field of required){
    if(originKey(fields[field])!==anchor||
       fields[field]?.recordId!==selected.recordId||
       fields.offers?.recordId!==selected.recordId)
      return 'cross_record_field_'+field;
  }
  if(!required.some(field=>['sku','mpn','gtin'].includes(field)))
    return 'missing_attributable_hard_identity';
  return null;
}
// Only explicitly compared claims may cross into a verified offer revision.
// In particular, never copy inbound independentlyAttested/verified/issuer flags
// or unrelated listing metadata into an attested customer-facing object.
function claimedOffer(offer,observedAt){
  const specs=offer?.specs||{};
  const variant=offer?.variant||{};
  const listed=keys=>Object.fromEntries(keys.filter(k=>
    Object.prototype.hasOwnProperty.call(offer||{},k)).map(k=>[k,offer[k]]));
  return {
    ...listed(['title','productPrice','currency','merchant','providerMarket',
      'sourceUrl','image','sku','mpn','gtin','modelNumber','brand','manufacturer',
      'availability','condition','storage','capacity','ram','region','sim',
      'color','edition','bundleContents']),
    observedAt,
    sourceMeta:offer?.sourceMeta?.productId!=null?{productId:offer.sourceMeta.productId}:{},
    specs:Object.fromEntries(['brand','modelNumber','color','storage','capacity',
      'ram','region','sim','condition','gtin','mpn'].filter(k=>
        Object.prototype.hasOwnProperty.call(specs,k)).map(k=>[k,specs[k]])),
    variant:Object.fromEntries(['storage','capacity','ram','region','sim','color',
      'edition','condition','bundleContents'].filter(k=>
        Object.prototype.hasOwnProperty.call(variant,k)).map(k=>[k,variant[k]]))
  };
}

function hardIdentity(value){
  return (typeof value==='string'||typeof value==='number')?
    String(value).trim().toLowerCase():null;
}
// Catalog identity is an anchor, not a field donor. All fields of an
// authoritative refreshed offer are copied exclusively from the selected
// merchant PDP; a disagreement with a shared hard identifier blocks it.
function bridgeCatalogIdentity(catalog,page){
  const sku=hardIdentity(catalog.sku??catalog.sourceMeta?.productId);
  const pdpSku=hardIdentity(page.sku);
  if(!sku||!pdpSku)return 'missing_listing_pdp_sku';
  if(sku!==pdpSku)return 'listing_pdp_sku_conflict';
  const pairs=[
    [catalog.modelNumber??catalog.specs?.modelNumber,page.specs?.modelNumber,'model'],
    [catalog.gtin??catalog.specs?.barcode,page.specs?.barcode,'gtin'],
  ];
  for(const [left,right,label] of pairs){
    if(hardIdentity(left)&&hardIdentity(right)&&hardIdentity(left)!==hardIdentity(right))
      return 'listing_pdp_'+label+'_conflict';
  }
  if(catalog.condition&&catalog.condition!=='unknown'&&
     page.condition&&page.condition!=='unknown'&&
     hardIdentity(catalog.condition)!==hardIdentity(page.condition))
    return 'listing_pdp_condition_conflict';
  const keys=['storage','capacity','ram','region','sim','color','edition'];
  for(const key of keys){
    const left=hardIdentity(catalog[key]??catalog.variant?.[key]??catalog.specs?.[key]);
    const right=hardIdentity(page[key]??page.variant?.[key]??page.specs?.[key]);
    if(left&&right&&left!==right)return 'listing_pdp_variant_'+key+'_conflict';
  }
  return null;
}
function selectedRecord(page){
  // Snapshot only documented selected-PDP fields; never enrich from a
  // neighboring listing or a caller-provided product record.
  return {
    title:page.title,productPrice:page.productPrice,currency:page.currency,
    merchant:page.merchant,sourceUrl:page.sourceUrl,image:page.image,
    sku:page.sku,mpn:page.mpn,gtin:page.gtin,
    specs:{
      brand:page.specs?.brand,modelNumber:page.specs?.modelNumber,
      color:page.specs?.color,storage:page.specs?.storage,
      ram:page.specs?.ram,region:page.specs?.region,sim:page.specs?.sim,
      barcode:page.specs?.barcode
    },
    condition:page.condition,availability:page.availability,
    variant:page.variant,
    storage:page.storage,capacity:page.capacity,ram:page.ram,
    region:page.region,sim:page.sim,color:page.color,
    edition:page.edition,bundleContents:page.bundleContents
  };
}
function rejection(reason,state='MISSING_EVIDENCE'){
  return Object.freeze({state,eligible:false,reason});
}

// A session's resolver is configured by trusted server code, never request
// JSON. The optional adapter is for deterministic Node tests; normal callers
// get the existing pinned-DNS, redirect-checked product resolver.
export function createPdpObservationSession({
  readSelectedPage=resolveSelectedJsonLdOffer,now=()=>Date.now(),
  maxRecords=MAX_RECORDS,maxAgeMs=MAX_CAPTURE_AGE_MS
}={}){
  if(typeof readSelectedPage!=='function'||typeof now!=='function')
    throw new TypeError('controlled_source_reader_required');
  if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>MAX_RECORDS||
     !Number.isInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>MAX_CAPTURE_AGE_MS)
    throw new RangeError('invalid_observation_budget');
  const observations=new Map();
  const verifier=createTrustedOfferVerifier({
    resolveObservation:async ref=>observations.get(ref)||null,now,maxAgeMs
  });
  async function runVerification(offer,{signal}={},mode='strict'){
    if(signal?.aborted)return rejection('cancelled','SOURCE_BLOCKED');
    if(offer?.providerMarket!==SOURCE_ID||offer?.merchant!=='Jarir'||
       !target(offer?.sourceUrl))
      return rejection('untrusted_or_unsupported_merchant');
    let page;
    try{page=await readSelectedPage(offer.sourceUrl,{signal});}
    catch{return rejection('merchant_observation_blocked','SOURCE_BLOCKED');}
    if(signal?.aborted)return rejection('cancelled','SOURCE_BLOCKED');
    if(page?.provider!=='url-resolver'||page?.dataKind!=='live'||
       page?.merchant!=='Jarir'||!target(page?.resolvedPageUrl)||
       !selectedDestination(offer.sourceUrl,page.resolvedPageUrl)||
       !selectedDestination(offer.sourceUrl,page.sourceUrl))
      return rejection('unattributable_destination','CONFLICTING_EVIDENCE');
    const provenanceProblem=sameRecordProvenance(page,offer);
    if(provenanceProblem)return rejection(provenanceProblem);
    const observationTime=Date.parse(page.observedAt),present=now();
    if(!Number.isFinite(observationTime)||!Number.isFinite(present)||
       observationTime>present+60_000||present-observationTime>maxAgeMs)
      return rejection('stale_or_invalid_observation');
    const record=selectedRecord(page);
    // The indexed listing has NO authority over PDP title, price or image.
    // In selected-revision mode it only anchors SKU, compatible hard identity,
    // condition and explicitly comparable variants.
    if(mode==='selected-revision'){
      const bridge=bridgeCatalogIdentity(offer,page);
      if(bridge)return rejection(bridge,/conflict/.test(bridge)?
        'CONFLICTING_EVIDENCE':'MISSING_EVIDENCE');
    }
    // A new source observation is a NEW offer revision: never retroactively
    // certify the stale indexed title/price/image as if they were observed.
    const updatedOffer=mode==='selected-revision'?
      claimedOffer({...record,providerMarket:SOURCE_ID},page.observedAt):
      claimedOffer(offer,page.observedAt);
    const ref='jarir-pdp:'+randomUUID();
    const revision=sha([page.resolvedPageUrl,page.observedAt,record,
      page.extraction.fieldSources,page.extraction.conflictSummary,
      page.extraction.selectedProductRecord]);
    const observation=Object.freeze({
      ref,revision,sourceId:SOURCE_ID,observedAt:page.observedAt,
      selectedRecord:Object.freeze(record)
    });
    if(observations.size>=maxRecords)observations.delete(observations.keys().next().value);
    observations.set(ref,observation);
    const decision=await verifier.verify({offer:updatedOffer,observationRef:ref});
    if(decision.state!=='VERIFIED'||!(await verifier.accepts(decision,updatedOffer,ref))){
      observations.delete(ref);
      return rejection(decision.reason||'same_offer_not_verified',
        decision.state==='CONFLICTING_EVIDENCE'?'CONFLICTING_EVIDENCE':'MISSING_EVIDENCE');
    }
    return Object.freeze({state:'VERIFIED',eligible:true,decision,
      originalListingSuperseded:mode==='selected-revision',
      observationRef:ref,offer:updatedOffer});
  }
  const verify=(offer,options)=>runVerification(offer,options,'strict');
  const verifySelectedRevision=(offer,options)=>
    runVerification(offer,options,'selected-revision');
  async function accepts(result,offer=result?.offer){
    return Boolean(result&&result.state==='VERIFIED'&&
      await verifier.accepts(result.decision,offer,result.observationRef));
  }
  function evidence(ref){
    const r=observations.get(ref);
    if(!r)return null;
    return Object.freeze({ref:r.ref,revision:r.revision,sourceId:r.sourceId,
      observedAt:r.observedAt,sourceUrl:r.selectedRecord.sourceUrl,
      title:r.selectedRecord.title,sku:r.selectedRecord.sku,
      price:r.selectedRecord.productPrice,currency:r.selectedRecord.currency});
  }
  return Object.freeze({verify,verifySelectedRevision,accepts,evidence});
}
