import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOffer} from '../server/tooling/offer-quality.mjs';
const offer={title:'Sample product',price:99,currency:'SAR',productUrl:'https://example.com/item',imageUrl:'https://example.com/image.jpg'};
test('checks required fields before background persistence',()=>{
 assert.deepEqual(inspectOffer(offer),{ok:true,failures:[]});
 assert.equal(inspectOffer({...offer,price:0}).ok,false);
 assert.equal(inspectOffer({...offer,price:'99'}).ok,false);
 assert.equal(inspectOffer({...offer,productUrl:'http://example.com/item'}).ok,false);
 assert.equal(inspectOffer({...offer,imageUrl:'bad-url'}).ok,false);
 assert.equal(inspectOffer(null).ok,false);
});
