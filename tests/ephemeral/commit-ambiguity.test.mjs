import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createEphemeralPool,initV2} from '../../server/persistence-v2.mjs';
import {initPersistence,recordOffer,writeLegacyOfferInTransaction} from '../../server/persistence.mjs';
import {initShadowOutbox,enqueueShadowIntentTx,processShadowOutbox} from '../../server/persistence-v2-outbox.mjs';

// Real local PostgreSQL connection is severed immediately after COMMIT is sent.
// We explicitly accept either server outcome and reconcile via a stable event ID.
const pool=createEphemeralPool();
await initPersistence();await initV2(pool);await initShadowOutbox(pool);
process.env.NAWAA_LEGACY_OUTBOX_SHADOW='1';
test.after(async()=>{delete process.env.NAWAA_LEGACY_OUTBOX_SHADOW;await pool.end();});
const item=()=>{const name=randomUUID();return {
 title:'Crash recovery CI fixture',sourceUrl:'https://www.jarir.com/sa/ci/'+name,
 sourceId:'jarir-sa',sourceName:'jarir-sa',sourceListingId:name,
 sourceVariantId:'128',sku:'SKU128',condition:'new',currency:'SAR',
 productPrice:555,observedAt:'2026-10-10T09:00:00.000Z'};};

test('real socket loss after issuing COMMIT is recoverable with stable event identity',async()=>{
 const eventId=randomUUID(),offer=item();
 const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:false});
 client.on('error',()=>{}); // expected transport failure while destroying the live socket
 await client.connect();
 const url=offer.sourceUrl.replace('www.jarir.com','jarir.com');
 const normalized={...offer,sourceUrl:url,ingestionId:eventId};
 const at=new Date(offer.observedAt);
 try{
  await client.query('BEGIN');
  await enqueueShadowIntentTx(client,normalized,{eventId});
  await writeLegacyOfferInTransaction(client,{
   sourceUrl:url,sourceName:offer.sourceName,price:555,currency:'SAR',observedAt:at,
   healthStatus:'healthy',key:url+'|new',query:offer.sourceName,title:offer.title,
   offerData:offer,condition:'new',normalized
  });
  const commit=client.query('COMMIT').catch(()=>{});
  // Destruction of a real pg TCP socket simulates acknowledgement loss.
  client.connection.stream.destroy();
  await commit;
 }finally{await client.end().catch(()=>{});}
 // The commit may have reached PostgreSQL or been aborted. Both are valid
 // outcomes. Retries MUST converge to one immutable observation and intent.
 await recordOffer({...offer,ingestionId:eventId});
 const rows=await pool.query('SELECT count(*)::int AS n FROM offer_observations WHERE product_url=$1',[url]);
 const intents=await pool.query('SELECT count(*)::int AS n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[eventId]);
 const offerRow=await pool.query('SELECT product_price FROM nawaa_offers WHERE offer_key=$1',[url+'|new']);
 assert.equal(rows.rows[0].n,1);
 assert.equal(intents.rows[0].n,1);
 assert.equal(Number(offerRow.rows[0].product_price),555);
});

test('expired processing claim is restored after abandoned worker; receipt is idempotent',async()=>{
 const offer=item(),eventId=randomUUID();
 await recordOffer({...offer,ingestionId:eventId});
 await pool.query(`UPDATE nawaa_v2_shadow_outbox SET status='processing',
  claim_token=$2,attempts=1,lease_until=now()-interval '1 minute'
  WHERE event_id=$1`,[eventId,randomUUID()]);
 const outcome=await processShadowOutbox(pool,{max:100});
 assert.ok(outcome.some(x=>x.id===eventId&&x.status==='completed'));
 await recordOffer({...offer,ingestionId:eventId});
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM nawaa_observation_v2 WHERE ingestion_id=$1',[eventId])).rows[0].n,1);
});
