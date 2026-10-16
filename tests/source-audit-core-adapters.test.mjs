import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFreeStorefronts} from '../server/source-audit.mjs';

const valid={title:'HP Pavilion Laptop 16GB',productPrice:2799,currency:'SAR',
  merchant:'Jarir',sourceUrl:'https://www.jarir.com/sa-en/products/hp-pavilion'};
const configs=[
  ['jarir','Jarir'],['extra','eXtra'],['sharafdg-sa','Sharaf DG'],['swarovski-sa','Swarovski']
];

test('core merchant audits use their dedicated adapters rather than the HTML storefront registry',async()=>{
  for(const [id,name] of configs){
    const calls=[];
    const report=await auditFreeStorefronts({storeId:id,query:'hp laptop',directSources:{
      [id]:{name,countryCode:'SA',run:async(q)=>{calls.push(q);return {provider:id,ok:true,offers:[valid],errors:[]}}},
    }});
    assert.deepEqual(calls,['hp laptop']);
    assert.equal(report.audited,1);
    assert.equal(report.liveVerified,1);
    assert.equal(report.results[0].id,id);
    assert.equal(report.results[0].status,'LIVE_VERIFIED');
    assert.equal(report.results[0].verifiedOffers,1);
  }
});

test('direct source audit never reports an unpriced or untrusted offer as verified',async()=>{
  const directSources={jarir:{name:'Jarir',countryCode:'SA',run:async()=>({offers:[
    {...valid,productPrice:null},{...valid,sourceUrl:'http://example.com/unsafe'},
    {...valid,currency:'???'},
  ],errors:[]})}};
  const report=await auditFreeStorefronts({storeId:'jarir',query:'HP',directSources});
  assert.equal(report.liveVerified,0);
  assert.equal(report.results[0].status,'CONNECTED_NO_VERIFIED_PRICE');
  assert.equal(report.results[0].candidates,3);
  assert.equal(report.results[0].verifiedOffers,0);
});

test('direct audit transport failures remain visible and unknown IDs remain rejected',async()=>{
  const directSources={jarir:{name:'Jarir',countryCode:'SA',run:async()=>{throw Error('HTTP 403')}}};
  const failed=await auditFreeStorefronts({storeId:'jarir',directSources});
  assert.equal(failed.failing,1);
  assert.equal(failed.results[0].status,'FAILING');
  assert.match(failed.results[0].error,/HTTP 403/);
  await assert.rejects(auditFreeStorefronts({storeId:'truly-unknown-source',directSources}),/unknown storefront/);
});
