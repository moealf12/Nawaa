import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {initPersistence,recordOffer,writeLegacyOfferInTransaction} from '../../server/persistence.mjs';
import {initShadowOutbox,enqueueShadowIntentTx} from '../../server/persistence-v2-outbox.mjs';

const pool=createEphemeralPool();
await initPersistence();
await initShadowOutbox(pool);
process.env.NAWAA_LEGACY_OUTBOX_SHADOW='1';
test.after(async()=>{delete process.env.NAWAA_LEGACY_OUTBOX_SHADOW;await pool.end();});

test('confirmed PostgreSQL COMMIT followed by lost application ACK is idempotent',async()=>{
 const eventId=randomUUID(),listing=randomUUID();
 const offer={title:'ACK loss fixture',sourceUrl:'https://www.jarir.com/sa/ack/'+listing,
  sourceId:'jarir-sa',sourceName:'jarir-sa',sourceListingId:listing,sourceVariantId:'128',
  sku:'SKU128',condition:'new',currency:'SAR',productPrice:777,
  observedAt:'2026-10-10T10:10:10.000Z',ingestionId:eventId};
 const normalized={...offer,sourceUrl:offer.sourceUrl.replace('www.jarir.com','jarir.com')};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await enqueueShadowIntentTx(client,normalized,{eventId});
  await writeLegacyOfferInTransaction(client,{
    sourceUrl:normalized.sourceUrl,sourceName:offer.sourceName,price:777,currency:'SAR',
    observedAt:new Date(offer.observedAt),healthStatus:'healthy',
    key:normalized.sourceUrl+'|new',query:offer.sourceName,title:offer.title,
    offerData:offer,condition:'new',normalized
  });
  await client.query('COMMIT'); // Server success is established before ACK is discarded.
  // Inject an application-level acknowledgement loss after confirmed commit.
 }finally{client.release();}
 const replay=await recordOffer(offer);
 assert.equal(replay.duplicate,true);
 const count=async(sql,args)=>(await pool.query(sql,args)).rows[0].n;
 assert.equal(await count('SELECT count(*)::int n FROM offer_observations WHERE product_url=$1',[normalized.sourceUrl]),1);
 assert.equal(await count('SELECT count(*)::int n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[eventId]),1);
 const row=(await pool.query('SELECT product_price FROM nawaa_offers WHERE offer_key=$1',[normalized.sourceUrl+'|new'])).rows[0];
 assert.equal(Number(row.product_price),777);
});
