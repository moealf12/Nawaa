import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDEXED_PRICE_MAX_AGE_MS,
  buildIndexedDocuments,
  indexOffers,
  restoreIndexedOffer,
  searchIndexedOffers,
} from '../server/search-index.mjs';

const now=Date.parse('2026-10-14T08:00:00.000Z');
const offer=(changes={})=>({
  title:'Apple iPhone 17 Pro 256GB',
  sourceUrl:'https://example.com/iphone/17pro',
  image:'https://example.com/phone.png',
  merchant:'Fixture Saudi',
  merchantCountryCode:'SA',
  productPrice:4999,
  currency:'SAR',
  observedAt:new Date(now-60_000).toISOString(),
  exactMatch:true,
  matchConfidence:1,
  availability:'in_stock',
  totalSAR:4999,
  ...changes,
});

test('indexing preserves original price observation and price metadata, not indexing time',async()=>{
  let inserted;
  const target={async addDocuments(docs){inserted=docs;}};
  const src=offer({productPrice:4998.75,originalCurrency:'USD',originalProductPrice:1333,
    fx:{rate:3.75,source:'Frankfurter',observedAt:new Date(now-86_400_000).toISOString()}});
  const result=await indexOffers([src],{target,now});
  assert.deepEqual(result,{configured:true,indexed:1});
  assert.equal(inserted[0].observedAt,src.observedAt);
  assert.notEqual(inserted[0].observedAt,new Date(now).toISOString());
  assert.equal(inserted[0].productPrice,4998.75);
  assert.equal(inserted[0].originalCurrency,'USD');
  assert.equal(inserted[0].originalProductPrice,1333);
  assert.equal(inserted[0].fx.source,'Frankfurter');
  assert.equal(inserted[0].imageUrl,src.image);
});

test('expired, future, invalid or unsupported price evidence cannot refresh indexed catalog',async()=>{
  const stale=new Date(now-INDEXED_PRICE_MAX_AGE_MS).toISOString();
  const invalid=[
    offer({observedAt:stale}),
    offer({observedAt:new Date(now+60_001).toISOString()}),
    offer({observedAt:'not-a-date'}),
    offer({observedAt:undefined}),
    offer({productPrice:0}),
    offer({productPrice:NaN}),
    offer({productPrice:'4999'}),
    offer({currency:'???'}),
    offer({currency:'USD'}), // must not compare USD units against SAR units
    offer({currency:null}),
    offer({sourceUrl:'http://example.com/phone'}),
    offer({sourceUrl:'https://user:pass@example.com/phone'}),
    offer({originalCurrency:'USD',originalProductPrice:1500}),
    offer({originalCurrency:'USD',originalProductPrice:1500,fx:{rate:3.75,source:'Frankfurter',observedAt:new Date(now).toISOString()}}), // valid-looking FX but wrong converted total
    offer({originalCurrency:'USD',originalProductPrice:1500,fx:{rate:-1,source:'FX',observedAt:new Date(now).toISOString()}}),
  ];
  let calls=0;
  const target={async addDocuments(){calls++;}};
  const result=await indexOffers(invalid,{target,now});
  assert.deepEqual(result,{configured:true,indexed:0});
  assert.equal(calls,0);
  assert.deepEqual(buildIndexedDocuments(invalid,{now}),[]);
});

test('indexed recall rejects old legacy hits and invalid prices instead of pretending live',async()=>{
  const hits=[
    offer({observedAt:new Date(now-2*INDEXED_PRICE_MAX_AGE_MS).toISOString()}),
    offer({observedAt:null}),
    offer({productPrice:null}),
    offer({currency:'WRONG'}),
    offer({currency:'USD'}),
    offer({originalCurrency:'EUR',originalProductPrice:4500}),
    offer(),
  ];
  let requestedAttributes;
  const target={async search(query,opts){
    assert.equal(query,'iphone 17');
    requestedAttributes=opts.attributesToRetrieve;
    return {hits};
  }};
  const result=await searchIndexedOffers('iphone 17',{target,now});
  assert.equal(result.offers.length,1);
  const [recalled]=result.offers;
  assert.equal(recalled.dataKind,'indexed');
  assert.equal(recalled.observedAt,hits.at(-1).observedAt);
  assert.equal(recalled.priceConfidence,'incomplete');
  assert.equal(recalled.availability,'unknown');
  assert.equal(recalled.totalSAR,null);
  assert.equal(recalled.image,hits.at(-1).image);
  assert.ok(requestedAttributes.includes('originalCurrency'));
  assert.ok(requestedAttributes.includes('originalProductPrice'));
  assert.ok(requestedAttributes.includes('fx'));
});

test('crossing the hard index age threshold invalidates recall without changing the record',()=>{
  const evidence=offer({observedAt:new Date(now-INDEXED_PRICE_MAX_AGE_MS+1).toISOString()});
  const accepted=restoreIndexedOffer(evidence,{now});
  assert.equal(accepted.productPrice,4999);
  assert.equal(accepted.dataKind,'indexed');
  assert.equal(restoreIndexedOffer(evidence,{now:now+1}),null);
  assert.equal(evidence.observedAt,new Date(now-INDEXED_PRICE_MAX_AGE_MS+1).toISOString());
});

test('missing index configuration remains zero-cost and does not invent recall',async()=>{
  // Explicit isolated index adapter avoids external services and credentials.
  assert.deepEqual(await searchIndexedOffers(' ',{target:{search:()=>{throw Error('never');}},now}),{configured:true,offers:[]});
});
