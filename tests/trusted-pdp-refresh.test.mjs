import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createControlledPdpRefresh} from '../server/trusted-pdp-refresh.mjs';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';
import {createTrustedObservationJournal} from '../server/trusted-observation-journal.mjs';
const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
const NOW=Date.parse('2026-10-24T16:00:00.000Z'),DIGEST='a'.repeat(64);
const candidate=()=>({providerMarket:'jarir-sa',merchant:'Jarir',sourceUrl:URL,
  title:'Stale PS5 listing',productPrice:2222,currency:'SAR',sku:'668751',
  specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White'},
  condition:'new',availability:'in_stock'});
const page=(price=2529,stamp=NOW-1000)=>({
  provider:'url-resolver',dataKind:'live',merchant:'Jarir',
  sourceUrl:URL,resolvedPageUrl:URL,observedAt:new Date(stamp).toISOString(),
  title:'PS5 Slim Disc Edition',productPrice:price,originalProductPrice:price,
  currency:'SAR',originalCurrency:'SAR',sku:'668751',
  image:'https://static.jarir.com/668751.jpg',
  condition:'new',availability:'in_stock',
  specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White'},
  extraction:{selectedProductRecord:{
    recordId:DIGEST,documentDigest:'b'.repeat(64),
    source:'jsonld_product_offer',selectedProductUrl:URL,selectedOfferUrl:URL,
    selectedCount:1,productCount:1
  },reconciled:false,availableStrategies:['jsonld'],
  identity:{summary:{accepted:1,rejected:0}},conflictSummary:{hasConflicts:false},
  fieldSources:Object.fromEntries(['offers','name','sku','mpn','image','brand','color','condition','availability']
    .map(name=>[name,{strategy:'jsonld',recordId:DIGEST}]))}
});
function store(){
  const rows=[],heads=new Map();
  const set=b=>{
    const existing=heads.get(b.sourceKey);
    if(existing&&Date.parse(b.observedAt)<Date.parse(existing.observedAt))return false;
    if(existing&&Date.parse(b.observedAt)===Date.parse(existing.observedAt)){
      if(existing.revision!==b.revision||existing.recordId!==b.recordId){
        heads.set(b.sourceKey,{...existing,conflicted:true});return false;
      }
      return !existing.conflicted;
    }
    heads.set(b.sourceKey,{...b,conflicted:false});return true;
  };
  return {
    rows,heads,
    append:async e=>{rows.push({...e})},
    events:async ref=>rows.filter(r=>r.ref===ref),
    currentHead:async ref=>heads.get(ref)||null,
    appendCapture:async(e,b)=>{if(!set(b))return false;rows.push({...e});return true},
    advanceHead:async b=>set(b)
  };
}
function context(){
  const st=store();
  const journal=createTrustedObservationJournal({store:st,
    signingKey:'v21.68-controlled-pdp-refresh-testing-key-do-not-use-in-production',
    now:()=>NOW+5000,requireCurrentHead:true});
  const make=(price,stamp)=>createControlledPdpRefresh({
    journal,now:()=>NOW+5000,
    createSession:()=>createPdpObservationSession({
      readSelectedPage:async()=>page(price,stamp),now:()=>NOW+5000
    })
  });
  return {st,journal,make};
}
test('v21.68 controlled source refresh writes latest PDP head but cannot grant a customer trust milestone',async()=>{
  const {st,journal,make}=context();
  const refresh=make(2529,NOW+3000);
  const result=await refresh.refresh({...candidate(),verified:true,
    independentlyAttested:true,badgeEligible:true});
  assert.equal(result.state,'RECORDED',result.reason);
  assert.equal(result.eligible,false);
  assert.equal(result.badgeEligible,false);
  assert.equal(result.firstTrustworthyOfferEligible,false);
  assert.equal(result.receiptRef,null);
  assert.equal(st.rows.length,0,'source freshness alone must not mint receipts');
  assert.equal(st.heads.size,1);
  const archived=await make(2529,NOW+3000).refresh(candidate(),{archive:true});
  assert.equal(archived.state,'RECORDED');
  assert.ok(archived.receiptRef);
  assert.equal((await journal.inspect(archived.receiptRef)).state,'REVALIDATED');
  assert.equal((await journal.inspect(archived.receiptRef)).badgeEligible,false);
  const changed=await make(2389,NOW+4000).refresh(candidate());
  assert.equal(changed.state,'RECORDED');
  assert.equal((await journal.inspect(archived.receiptRef)).state,'SUPERSEDED');
});
test('v21.68 unsupported, cloned source result, missing verifier and failing journal cannot refresh',async()=>{
  const {st,journal,make}=context();
  for(const offer of [null,{...candidate(),merchant:'eXtra'},
    {...candidate(),sourceUrl:'http://www.jarir.com/test'}]){
    const result=await make(2529,NOW+3000).refresh(offer);
    assert.notEqual(result.state,'RECORDED');
  }
  assert.equal(st.heads.size,0);
  const forged=createControlledPdpRefresh({journal,
    createSession:()=>({verifySelectedRevision:async()=>({
      state:'VERIFIED',eligible:true,wholeOfferVerified:false,badgeEligible:false,
      decision:{state:'VERIFIED'},offer:candidate()
    }),accepts:async()=>true})});
  assert.equal((await forged.refresh(candidate())).state,'MISSING_EVIDENCE',
    'only the private issued-verified decision registry may update the source head');
  assert.equal(st.heads.size,0);
  const broken=createControlledPdpRefresh({journal,createSession:()=>({})});
  assert.equal((await broken.refresh(candidate())).reason,'invalid_controlled_verifier');
});
test('v21.68 cancellation and timeout cannot create a late trusted source head',async()=>{
  const {st,journal}=context();
  const external=new AbortController();
  const stalled=createControlledPdpRefresh({journal,timeoutMs:30,
    createSession:()=>createPdpObservationSession({
      readSelectedPage:async()=>{await new Promise(resolve=>setTimeout(resolve,65));return page(2529,NOW+3000)},
      now:()=>NOW+5000
    })});
  assert.equal((await stalled.refresh(candidate())).state,'SOURCE_BLOCKED');
  assert.equal(st.heads.size,0);
  external.abort();
  assert.equal((await stalled.refresh(candidate(),{signal:external.signal})).state,'SOURCE_BLOCKED');
});
test('v21.68 refresh honors a source revision change but refuses replay of an older controlled PDP',async()=>{
  const {st,make}=context();
  const fresh=await make(2300,NOW+4000).refresh(candidate());
  assert.equal(fresh.state,'RECORDED');
  const old=await make(2500,NOW+3000).refresh(candidate());
  assert.equal(old.state,'SUPERSEDED');
  assert.equal(st.heads.size,1);
});
