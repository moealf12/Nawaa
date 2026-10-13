import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveOfferIdentityV2} from '../server/offer-identity-v2.mjs';

const base={sourceId:'jarir-sa',sourceUrl:'https://www.jarir.com/sa/item/100',sourceListingId:'100',sourceVariantId:'128gb'};
const key = v => deriveOfferIdentityV2({...base,...v}).offerKey;

test('variants at one URL never collide',()=>{
 assert.notEqual(key({sourceVariantId:'128gb'}),key({sourceVariantId:'256gb'}));
});
test('identical listing and variant produce stable identity independent of price and title',()=>{
 assert.equal(key({title:'Old',productPrice:20}),key({title:'New',productPrice:30}));
});
test('a second merchant cannot overwrite the first merchant offer',()=>{
 assert.notEqual(key({sourceId:'extra-sa'}),key({sourceId:'jarir-sa'}));
});
test('tracking parameters and fragment do not fork a genuine offer',()=>{
 assert.equal(key({sourceUrl:'https://www.jarir.com/sa/item/100?utm_source=x#top'}),key({sourceUrl:'https://jarir.com/sa/item/100'}));
});
test('unknown variant cannot merge by URL alone',()=>{
 assert.throws(()=>deriveOfferIdentityV2({sourceId:'jarir-sa',sourceUrl:base.sourceUrl}),/missing_variant_disambiguator/);
});
test('SKU can be used as source-scoped variant evidence when no variant ID is present',()=>{
 const first=key({sourceVariantId:null,sku:'ABC-128'});
 const other=key({sourceVariantId:null,sku:'ABC-256'});
 assert.notEqual(first,other);
});
test('URL, condition and source validation fail closed',()=>{
 assert.throws(()=>key({sourceUrl:'http://127.0.0.1/'}),/invalid_offer_url/);
 assert.throws(()=>key({condition:'unknown'}),/invalid_condition/);
 assert.throws(()=>key({sourceId:'../escape'}),/invalid_source_id/);
});
test('condition changes an offer identity',()=>{
 assert.notEqual(key({condition:'new'}),key({condition:'used'}));
});
