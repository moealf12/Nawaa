import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {ownOfferImages} from '../src/product-image-ownership.mjs';

test('image display cannot borrow neighboring group offer without ownership evidence',()=>{
  const chosen={title:'Phone 256GB',image:null,sku:'SKU-256'};
  const neighbor={title:'Phone 512GB',image:'https://img.example/512gb.jpg',sku:'SKU-512'};
  assert.deepEqual(ownOfferImages(chosen,{offers:[chosen,neighbor]}),[]);
});

test('offer-specific image retained, without secondary images or extra variants',()=>{
  const main={image:'https://img.example/256gb.jpg',sku:'SKU-256'};
  const different={image:'https://img.example/512gb.jpg',sku:'SKU-512'};
  assert.deepEqual(ownOfferImages(main,{offers:[main,different]}),[main.image]);
});

test('unsafe or invalid protocols and credentialed image URLs are excluded',()=>{
  for(const image of [
    'javascript:alert(1)','data:text/html,x','file:///tmp/x','not a url',
    'https://user:pass@img.example/record.jpg','https://','',
  ])assert.deepEqual(ownOfferImages({image}),[],image);
});

test('image candidates remain a subset of own offer for arbitrary foreign group images',()=>{
  fc.assert(fc.property(fc.webUrl(),fc.webUrl(),(own,foreign)=>{
    const offer={image:own};
    const results=ownOfferImages(offer,{offers:[offer,{image:foreign}]});
    assert.ok(results.length<=1);
    assert.ok(results.every(x=>x===own));
  }),{seed:2157,numRuns:64});
});
