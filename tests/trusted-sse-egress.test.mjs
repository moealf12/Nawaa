import test from 'node:test';
import assert from 'node:assert/strict';
import {stripUntrustedCustomerTrustClaims as scrub} from '../server/trusted-sse-egress.mjs';

const base={merchant:'Jarir',providerMarket:'jarir-sa',
  title:'Sony PS5 Slim Disc 1TB',productPrice:2749,currency:'SAR',
  sourceUrl:'https://www.jarir.com/item?sku=668751',
  image:'https://www.jarir.com/image/668751.jpg',
  sourceMeta:{productId:'668751',parsedFrom:'jarir-catalog'},
  specs:{brand:'Sony',modelNumber:'CFI2116A01Y',storage:'1TB'}};
test('v21.71 real SSE egress retains product identity, merchant evidence and ordering',()=>{
  const first={...base,sourceMeta:{...base.sourceMeta,verified:true}};
  const second={...base,sourceUrl:'https://www.jarir.com/item?sku=668752',
    productPrice:3000};
  const original={offers:[first,second],nextCursor:'signed-cursor',
    coverage:{partial:true,providersPending:1}};
  const untouched=structuredClone(original);
  const clean=scrub(original);
  assert.deepEqual(clean.offers[0].specs,base.specs);
  assert.equal(clean.offers[0].sourceMeta.productId,'668751');
  assert.equal(clean.offers[0].sourceMeta.parsedFrom,'jarir-catalog');
  assert.equal(Object.hasOwn(clean.offers[0].sourceMeta,'verified'),false);
  assert.equal(clean.offers[1].productPrice,3000);
  assert.equal(clean.nextCursor,'signed-cursor');
  assert.equal(clean.coverage,original.coverage);
  assert.deepEqual(original,untouched,'upstream and index records must stay untouched');
});
test('v21.71 forged trust at snapshot, offer, sourceMeta levels cannot reach customer SSE',()=>{
  const forged={
    offers:[{...base,badgeEligible:true,customerVerified:true,
      certificateScope:'selected_sellable_offer',wholeOfferVerified:true,
      trustedVerifier:true,verified:true,verificationStatus:'VERIFIED',
      sourceMeta:{...base.sourceMeta,issuer:'Jarir',sourcePredicatesRevalidated:true,
        trustReceipt:{signature:'fake'}}}],
    streamGeneration:'attacker-generation',
    displayTrustContext:{badgeEligible:true},sourcePredicateEvidence:{badgeEligible:true},
    trustBadge:true,trustCertification:'VERIFIED',nextCursor:'safe'
  };
  const safe=scrub(forged);
  assert.equal(safe.nextCursor,'safe');
  for(const target of [safe,safe.offers[0],safe.offers[0].sourceMeta]){
    for(const key of ['badgeEligible','customerVerified','verified',
      'wholeOfferVerified','sourcePredicatesRevalidated',
      'trustReceipt','issuer','streamGeneration','displayTrustContext',
      'sourcePredicateEvidence']){
      assert.equal(Object.hasOwn(target,key),false,'field leaked: '+key);
    }
  }
});
test('v21.71 no-op ordinary offer survives without deep clone cost',()=>{
  const original={offers:[base],providers:[],errors:[]};
  const safe=scrub(original);
  assert.equal(safe.offers[0],base,'clean offer should stay zero-copy');
  assert.deepEqual(safe.offers,original.offers);
  assert.equal(safe.providers,original.providers);
  assert.equal(safe.errors,original.errors);
});
test('v21.71 prototype injection cannot promote forged trust field',()=>{
  const polluted=JSON.parse('{"title":"X","productPrice":10,"__proto__":{"badgeEligible":true},"badgeEligible":true}');
  const result=scrub({offers:[polluted]});
  assert.equal(Object.hasOwn(result.offers[0],'badgeEligible'),false);
  assert.equal(Object.hasOwn(result.offers[0],'__proto__'),true,
    'unrelated source payload is unchanged; no trusted claim is inferred');
  assert.equal({}.badgeEligible,undefined);
});
