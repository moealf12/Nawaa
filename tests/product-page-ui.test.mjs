import test from 'node:test';
import assert from 'node:assert/strict';

test('product details resolve the URL-selected variant instead of a stale snapshot and keep the customer inside Nawaa',async()=>{
 const elements=new Map();const element=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',events:{},addEventListener(name,fn){this.events[name]=fn;}});return elements.get(key);};
 globalThis.document={querySelector:element,title:''};
 const source='https://merchant.example/products/shirt?variant=2';
 globalThis.location={href:'https://nawaa.example/product.html?source='+encodeURIComponent(source)};
 globalThis.window={NAWAA_API_BASE:'https://nawaa.example/live',NAWAA_QUOTE_URL:'/'};
 const old={offer:{title:'Old shirt',sourceUrl:'https://merchant.example/products/shirt?variant=1',productPrice:100}};
 globalThis.sessionStorage={getItem(){return JSON.stringify(old);}};
 globalThis.localStorage={getItem(){throw Error('storage blocked');}};
 const calls=[];globalThis.fetch=async(url,options)=>{
  calls.push({url,options});return {ok:true,json:async()=>({offer:{title:'Selected shirt size L',sourceUrl:source,productPrice:200,sku:'SHIRT-L',condition:'new'}})};
 };
 await import('../src/product-page.mjs');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1,'another variant in storage must be re-resolved');
 assert.equal(new URL(calls[0].url).searchParams.get('url'),source);
 assert.equal(calls[0].options.credentials,'same-origin');
 assert.match(element('#productApp').innerHTML,/Selected shirt size L/);
 assert.doesNotMatch(element('#productApp').innerHTML,/Old shirt/);
 assert.doesNotMatch(element('#productApp').innerHTML,/href="https:\/\/merchant\.example|فتح المصدر/);
 assert.ok(element('#quoteBtn').events.click,'quotation handoff remains available');
 element('#quoteBtn').events.click();
 assert.equal(new URL(location.href).origin,'https://nawaa.example');
 assert.match(new URL(location.href).searchParams.get('request'),/Selected shirt size L/);
});
