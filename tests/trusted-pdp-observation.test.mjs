import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdpObservationSession} from '../server/trusted-pdp-observation.mjs';

const URL='https://www.jarir.com/sa-en/sony-playstation-5-slim-gaming-consoles-and-handheld-668751.html';
const CLOCK=Date.parse('2026-10-24T12:00:00.000Z');
const observedAt=new Date(CLOCK-1500).toISOString();
const origin={strategy:'jsonld',adapterId:null};
const fields=()=>Object.fromEntries(['offers','name','sku','mpn','brand','image','color'].map(k=>[k,{...origin}]));
const page=()=>({
  provider:'url-resolver',providerMarket:'www.jarir.com',dataKind:'live',merchant:'Jarir',
  resolvedPageUrl:URL,sourceUrl:URL,observedAt,
  title:'Sony PS5 Slim Disc Console',sku:'668751',
  productPrice:2529,originalProductPrice:2529,currency:'SAR',originalCurrency:'SAR',
  image:'https://static.jarir.com/668751.jpg',
  specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White'},
  condition:'new',availability:'in_stock',
  extraction:{fieldSources:fields(),conflictSummary:{hasConflicts:false},
    reconciled:false,availableStrategies:['jsonld'],
    identity:{summary:{accepted:1,rejected:0}}}
});
const offer=()=>({
  title:'Sony PS5 Slim Disc Console',sku:'668751',merchant:'Jarir',providerMarket:'jarir-sa',
  productPrice:2529,currency:'SAR',sourceUrl:URL,
  image:'https://static.jarir.com/668751.jpg',
  observedAt:new Date(CLOCK-9000).toISOString(),condition:'new',
  availability:'in_stock',specs:{brand:'Sony',modelNumber:'CFI2116B01Y',color:'White'}
});
function setup(readSelectedPage=async()=>page(),override={}){
  return createPdpObservationSession({readSelectedPage,now:()=>CLOCK,...override});
}
test('v21.62 positive: controlled seller PDP single-priced-record evidence verifies a fresh offer revision',async()=>{
  const source=offer();
  const session=setup();
  const verified=await session.verify(source);
  assert.equal(verified.state,'VERIFIED');
  assert.equal(verified.eligible,true);
  assert.notEqual(verified.offer,source);
  assert.equal(source.observedAt,new Date(CLOCK-9000).toISOString(),'original observation must not be rewritten');
  assert.equal(verified.offer.observedAt,observedAt);
  assert.equal(verified.decision.predicates.price,'VERIFIED');
  assert.equal(await session.accepts(verified),true);
  assert.equal(await session.accepts({...verified,decision:{...verified.decision}}),false);
  assert.equal(await setup().accepts(verified),false,'decision cannot replay in another verifier session');
  const evidence=session.evidence(verified.observationRef);
  assert.equal(evidence.sourceUrl,URL);
  assert.equal(evidence.sku,'668751');
  assert.equal(evidence.price,2529);
  assert.equal(evidence.currency,'SAR');
});
test('v21.62: forged self-attestation and arbitrary caller fields never mint VERIFIED',async()=>{
  const session=setup();
  for(const mutation of [
    {providerMarket:'fake-sa'},
    {merchant:'eXtra'},
    {sourceUrl:'https://unrelated.invalid/product'},
    {sourceUrl:'https://jarir.com.evil.invalid/x'},
    {sourceUrl:'https://user:pass@www.jarir.com/x'},
    {sourceUrl:'http://www.jarir.com/x'},
    {sourceUrl:'https://www.jarir.com:8443/x'},
  ])assert.equal((await session.verify({...offer(),...mutation})).eligible,false);
  assert.equal(await session.accepts({
    state:'VERIFIED',eligible:true,decision:{state:'VERIFIED'}
  }),false);
  const flagged=await session.verify({...offer(),independentlyAttested:true,eligible:true});
  assert.equal(flagged.state,'VERIFIED','flags ignored; genuine controlled PDP evidence required');
});
test('v21.62: same-origin field ownership is mandatory (no price plus adjacent SKU/title/image)',async()=>{
  for(const mutatedField of ['name','sku','mpn','image','brand','color']){
    const session=setup(async()=>({
      ...page(),extraction:{...page().extraction,
        fieldSources:{...fields(),[mutatedField]:{strategy:'hydrated_state'}}}
    }));
    const result=await session.verify(offer());
    assert.equal(result.eligible,false,mutatedField);
    assert.equal(result.reason,'cross_record_field_'+mutatedField);
  }
});
test('v21.62: conflicting and missing reconciliation metadata fail closed',async()=>{
  const badPages=[
    {...page(),extraction:null},
    {...page(),extraction:{...page().extraction,conflictSummary:{hasConflicts:true}}},
    {...page(),extraction:{...page().extraction,identity:{summary:{rejected:1}}}},
    {...page(),extraction:{...page().extraction,fieldSources:{}}},
    {...page(),originalCurrency:'USD'},
    {...page(),originalProductPrice:3000},
    {...page(),extraction:{...page().extraction,fieldSources:{...fields(),offers:{strategy:'meta'}}}}
  ];
  for(const resultPage of badPages){
    const session=setup(async()=>resultPage);
    assert.equal((await session.verify(offer())).eligible,false);
  }
});
test('v21.62: selected-PDP identity/variant/seller/price/image conflicts reject a different item',async()=>{
  for(const [field,value] of [
    ['title','Sony PS5 Disc Drive Accessory'],
    ['sku','644723'],
    ['productPrice',2799],
    ['currency','USD'],
    ['merchant','eXtra'],
    ['image','https://static.jarir.com/other.jpg'],
    ['availability','out_of_stock'],
    ['sourceUrl','https://www.jarir.com/sa-en/other-product.html']
  ]){
    const bad={...page(),[field]:value};
    if(field==='productPrice')bad.originalProductPrice=value;
    const session=setup(async()=>bad);
    const verified=await session.verify(offer());
    assert.equal(verified.eligible,false,field);
  }
});
test('v21.62: PDP redirect and selected-query mismatch never certify',async()=>{
  const session=setup(async()=>({...page(),resolvedPageUrl:
    URL.replace('668751','644723')}));
  assert.equal((await session.verify(offer())).eligible,false);
  const item={...offer(),sourceUrl:URL+'?sku=668751'};
  assert.equal((await setup().verify(item)).eligible,false,'selected SKU must survive redirection');
  const duplicate={...offer(),sourceUrl:URL+'?sku=668751&sku=644723'};
  assert.equal((await setup().verify(duplicate)).eligible,false);
});
test('v21.62: blocked, expired, future and aborted source observations cannot issue authority',async()=>{
  const source=offer();
  const blocked=setup(async()=>{throw new Error('HTTP 403')});
  assert.equal((await blocked.verify(source)).state,'SOURCE_BLOCKED');
  assert.equal((await setup().verify(source,{signal:{aborted:true}})).state,'SOURCE_BLOCKED');
  const stale=setup(async()=>({...page(),observedAt:new Date(CLOCK-400_000).toISOString()}));
  assert.equal((await stale.verify(source)).eligible,false);
  const future=setup(async()=>({...page(),observedAt:new Date(CLOCK+120_000).toISOString()}));
  assert.equal((await future.verify(source)).eligible,false);
});
test('v21.62: bounded session evicts previous evidence and cannot replay it',async()=>{
  const session=setup(async()=>page(),{maxRecords:1});
  const first=await session.verify(offer());
  assert.equal(first.state,'VERIFIED');
  const second=await session.verify(offer());
  assert.equal(second.state,'VERIFIED');
  assert.equal(await session.accepts(first),false);
  assert.equal(session.evidence(first.observationRef),null);
  assert.equal(await session.accepts(second),true);
});
test('v21.62: invalid budgets reject unsafe session settings',()=>{
  assert.throws(()=>setup(async()=>page(),{maxRecords:0}),/invalid_observation_budget/);
  assert.throws(()=>setup(async()=>page(),{maxRecords:100000}),/invalid_observation_budget/);
  assert.throws(()=>setup(async()=>page(),{maxAgeMs:86400000}),/invalid_observation_budget/);
});

test('v21.62 end-to-end: existing URL resolver consumes selected Jarir JSON-LD record without extra verifier network privileges',async()=>{
  const dns=(await import('node:dns/promises')).default;
  const {resolveProductUrl}=await import('../server/url-resolver.mjs');
  const originalFetch=globalThis.fetch,originalLookup=dns.lookup;
  const jsonLd={
    '@type':'Product',name:offer().title,sku:'668751',mpn:'CFI2116B01Y',
    url:URL,image:'https://static.jarir.com/668751.jpg',
    brand:{'@type':'Brand',name:'Sony'},color:'White',
    itemCondition:'https://schema.org/NewCondition',
    offers:{'@type':'Offer',url:URL,price:'2529',priceCurrency:'SAR',
      availability:'https://schema.org/InStock'}
  };
  try{
    dns.lookup=async()=>[{address:'93.184.216.34',family:4}];
    globalThis.fetch=async()=>new Response(
      '<script type="application/ld+json">'+JSON.stringify({
        '@context':'https://schema.org','@graph':[jsonLd]
      })+'</script>',{headers:{'content-type':'text/html'}}
    );
    const session=createPdpObservationSession({readSelectedPage:resolveProductUrl,
      now:()=>Date.now()});
    const result=await session.verify(offer());
    assert.equal(result.state,'VERIFIED',result.reason);
    assert.equal(await session.accepts(result),true);
    assert.equal(result.offer.sku,'668751');
  }finally{
    dns.lookup=originalLookup;
    globalThis.fetch=originalFetch;
  }
});

test('v21.62: Schema.org itemCondition normalized with explicitly bounded meaning',async()=>{
  const {normalizeCondition}=await import('../server/provider-utils.mjs');
  assert.equal(normalizeCondition('https://schema.org/NewCondition'),'new');
  assert.equal(normalizeCondition('https://schema.org/UsedCondition'),'used');
  assert.equal(normalizeCondition('https://schema.org/RefurbishedCondition'),'refurbished');
  assert.equal(normalizeCondition('https://schema.org/DamagedCondition'),'unknown');
  assert.equal(normalizeCondition('https://schema.org/UnknownCondition'),'unknown');
  assert.equal(normalizeCondition('new'),'new');
  assert.equal(normalizeCondition('renewed'),'refurbished');
});
test('v21.62: inbound authority-looking flags are not propagated to attested record revision',async()=>{
  const session=setup();
  const attempt=await session.verify({...offer(),
    independentlyAttested:true,verified:true,eligible:true,
    issuer:'merchant-self',verificationStatus:'VERIFIED',
    evidenceDigest:'untrusted',unrelatedNested:{fakeCertificate:true}
  });
  assert.equal(attempt.state,'VERIFIED');
  for(const key of ['independentlyAttested','verified','eligible','issuer',
    'verificationStatus','evidenceDigest','unrelatedNested']){
    assert.equal(Object.hasOwn(attempt.offer,key),false,key);
  }
  assert.equal(await session.accepts(attempt),true);
});

test('v21.62: equal parser strategy does not prove identical record when two Products are discovered',async()=>{
  for(const extraction of [
    {...page().extraction,availableStrategies:['jsonld','jsonld']},
    {...page().extraction,identity:{summary:{accepted:2,rejected:0}}},
    {...page().extraction,reconciled:true},
    {...page().extraction,availableStrategies:['hydrated_state']},
    {...page().extraction,availableStrategies:['jsonld','meta']}
  ]){
    const attempt=await setup(async()=>({...page(),extraction})).verify(offer());
    assert.equal(attempt.eligible,false,JSON.stringify(extraction));
    assert.equal(attempt.reason,'ambiguous_product_reconciliation');
  }
});
