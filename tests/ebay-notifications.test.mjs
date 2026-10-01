import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createEbayDeletionHandler } from '../server/ebay-notifications.mjs';
import { createSearchCache } from '../server/search-cache.mjs';

const token = 'a'.repeat(64), endpoint = 'https://example.org/api/ebay/account-deletion';
const {privateKey, publicKey} = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
const payload = {metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION',schemaVersion:'1.0'}, notification:{notificationId:'event-1',data:{userId:'deleted-user',username:'seller',eiasToken:'opaque'}}};
function signed(body) {
 return Buffer.from(JSON.stringify({kid:'key-1',signature:sign('sha1',Buffer.from(body),privateKey).toString('base64')})).toString('base64');
}
async function request(handler, method, body='', header='', query='') {
 const req=Readable.from([Buffer.from(body)]);req.method=method;req.headers={'x-ebay-signature':header};
 let status, response=''; const res={writeHead(s){status=s;},end(s=''){response=s;}};
 await handler(req,res,new URL(endpoint+query));return {status,response};
}
test('challenge hashes configured canonical endpoint, independent of incoming host',async()=>{
 const handler=createEbayDeletionHandler({token,endpoint,getPublicKey:async()=>publicKey,onDelete:()=>{}});
 const response=await request(handler,'GET','','','?challenge_code=challenge');
 assert.equal(response.status,200);
 assert.equal(JSON.parse(response.response).challengeResponse,createHash('sha256').update('challenge'+token+endpoint).digest('hex'));
 assert.equal((await request(handler,'GET')).status,400);
});
test('signed deletion clears state before acknowledging; repeats are safe',async()=>{
 let deleted=0; const handler=createEbayDeletionHandler({token,endpoint,getPublicKey:async()=>publicKey,onDelete:()=>{deleted++;}});
 const body=JSON.stringify(payload);
 assert.equal((await request(handler,'POST',body,signed(body))).status,204);
 assert.equal((await request(handler,'POST',body,signed(body))).status,204);
 assert.equal(deleted,2);
 assert.equal((await request(handler,'POST',body.replace('seller','tampered'),signed(body))).status,412);
 assert.equal((await request(handler,'POST',body)).status,412);assert.equal(deleted,2);
});
test('processing failures and public key outages are retryable, unrelated topics rejected',async()=>{
 const body=JSON.stringify(payload);
 let handler=createEbayDeletionHandler({token,endpoint,getPublicKey:async()=>{throw Error('offline');},onDelete:()=>{}});
 assert.equal((await request(handler,'POST',body,signed(body))).status,503);
 handler=createEbayDeletionHandler({token,endpoint,getPublicKey:async()=>publicKey,onDelete:()=>{throw Error('storage failure');}});
 assert.equal((await request(handler,'POST',body,signed(body))).status,503);
 const other=JSON.stringify({...payload,metadata:{topic:'OTHER'}});
 assert.equal((await request(handler,'POST',other,signed(other))).status,400);
 assert.equal((await request(handler,'POST','x'.repeat(65537),signed(body))).status,413);
});
test('invalidation discards cached and in-flight snapshots',async()=>{
 let resolve, calls=0;
 const cached=createSearchCache(async()=>{calls++;if(calls===1)await new Promise(r=>resolve=r);return {offers:[{title:'fresh'}],errors:[]};});
 const first=cached('hp');await Promise.resolve();cached.clear();resolve();
 assert.deepEqual((await first).offers,[]);
 await cached('hp');assert.equal(calls,2);cached.clear();await cached('hp');assert.equal(calls,3);
});

test('public signing keys are fetched from eBay only and expire after an hour',async()=>{
 const {createEbayPublicKeyLoader}=await import('../server/ebay-notifications.mjs');
 let calls=0,clock=0;
 const loader=createEbayPublicKeyLoader({getToken:async()=>'application-token',now:()=>clock,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.ebay.com/commerce/notification/v1/public_key/key-1');
  assert.equal(options.headers.authorization,'Bearer application-token');
  return {ok:true,json:async()=>({key:publicKey.export({type:'spki',format:'pem'})})};
 }});
 assert.equal((await loader('key-1')).asymmetricKeyType,'ec');await loader('key-1');assert.equal(calls,1);
 clock=3600001;await loader('key-1');assert.equal(calls,2);
});
test('eBay search never passes seller account data into normalized offers',async(t)=>{
 const originalFetch=globalThis.fetch, originalId=process.env.EBAY_CLIENT_ID, originalSecret=process.env.EBAY_CLIENT_SECRET;
 t.after(()=>{globalThis.fetch=originalFetch;if(originalId===undefined)delete process.env.EBAY_CLIENT_ID;else process.env.EBAY_CLIENT_ID=originalId;if(originalSecret===undefined)delete process.env.EBAY_CLIENT_SECRET;else process.env.EBAY_CLIENT_SECRET=originalSecret;});
 process.env.EBAY_CLIENT_ID='fixture-id';process.env.EBAY_CLIENT_SECRET='fixture-secret';
 globalThis.fetch=async(url)=>({ok:true,json:async()=>String(url).includes('oauth2')?{access_token:'fixture-token',expires_in:3600}:{itemSummaries:[{title:'HP laptop',price:{value:'1000',currency:'SAR'},seller:{username:'personal-seller',userId:'private-id'},itemWebUrl:'https://www.ebay.com/itm/123',condition:'New'}]}});
 const {searchEbayWorldwide}=await import('../server/providers/ebay.mjs');
 const result=await searchEbayWorldwide('hp',{marketLimit:1});
 assert.equal(result.offers[0].merchant,'eBay');assert.equal(result.offers[0].productPrice,1000);
 assert.ok(!JSON.stringify(result).includes('personal-seller'));assert.ok(!JSON.stringify(result).includes('private-id'));
});
