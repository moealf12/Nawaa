import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {recordOffer,initPersistence} from '../../server/persistence.mjs';
import {initShadowOutbox} from '../../server/persistence-v2-outbox.mjs';

process.env.NAWAA_LEGACY_OUTBOX_SHADOW='1';
const pool=createEphemeralPool();
await initPersistence();
await initShadowOutbox(pool);
test.after(async()=>{delete process.env.NAWAA_LEGACY_OUTBOX_SHADOW; await pool.end()});
const make=(name,variant='128')=>({
 title:'Legacy transactional fixture',sourceUrl:'https://www.jarir.com/sa/ci/'+name,
 sourceId:'jarir-sa',sourceName:'jarir-sa',sourceListingId:name,
 sourceVariantId:variant,sku:'sku-'+variant,productPrice:199,currency:'SAR',
 observedAt:'2026-10-10T11:22:33Z',condition:'new'
});
test('legacy observation + current + outbox intent commit together and replay is idempotent',async()=>{
 const id=randomUUID(),offer=make(randomUUID());
 const first=await recordOffer({...offer,ingestionId:id});
 assert.equal(first.recorded,true);
 const result=await recordOffer({...offer,ingestionId:id});
 assert.equal(result.duplicate,true);
 const ob=await pool.query('SELECT count(*)::int n FROM offer_observations WHERE product_url=$1 AND source_name=$2',[offer.sourceUrl.replace('www.jarir.com','jarir.com'),offer.sourceId]);
 assert.equal(ob.rows[0].n,1);
 const out=await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id]);
 assert.equal(out.rows[0].n,1);
 await assert.rejects(recordOffer({...offer,productPrice:99,ingestionId:id}),/event_id_payload_conflict/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM offer_observations WHERE product_url=$1',[offer.sourceUrl.replace('www.jarir.com','jarir.com')])).rows[0].n,1);
});
test('canonical SQL failure rolls back historical observation and durable intent',async()=>{
 const id=randomUUID(),offer=make(randomUUID());
 // Test-only constraint on an isolated table; no production object is touched.
 await pool.query(`CREATE OR REPLACE FUNCTION nawaa_ci_legacy_abort() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.source_url LIKE '%ci_abort_fixture%' THEN RAISE EXCEPTION 'ci_abort_fixture'; END IF; RETURN NEW; END; $$`);
 await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_legacy_abort ON nawaa_offers');
 await pool.query('CREATE TRIGGER nawaa_ci_legacy_abort BEFORE INSERT OR UPDATE ON nawaa_offers FOR EACH ROW EXECUTE FUNCTION nawaa_ci_legacy_abort()');
 const broken={...offer,sourceUrl:'https://www.jarir.com/sa/ci_abort_fixture/'+randomUUID()};
 try{
  await assert.rejects(recordOffer({...broken,ingestionId:id}),/ci_abort_fixture/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM offer_observations WHERE product_url=$1',[broken.sourceUrl.replace('www.jarir.com','jarir.com')])).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id])).rows[0].n,0);
 }finally{await pool.query('DROP TRIGGER IF EXISTS nawaa_ci_legacy_abort ON nawaa_offers');}
});
test('concurrent callers with same event ID write one legacy observation',async()=>{
 const id=randomUUID(),offer=make(randomUUID());
 const results=await Promise.all(Array.from({length:4},()=>recordOffer({...offer,ingestionId:id})));
 assert.equal(results.filter(x=>x.duplicate===true).length,3);
 assert.equal((await pool.query('SELECT count(*)::int n FROM offer_observations WHERE product_url=$1',[offer.sourceUrl.replace('www.jarir.com','jarir.com')])).rows[0].n,1);
});
test('shadow rejects ambiguous variant before committing anything',async()=>{
 const id=randomUUID(),offer=make(randomUUID());
 delete offer.sourceVariantId;delete offer.sku;
 await assert.rejects(recordOffer({...offer,ingestionId:id}),/missing_variant_disambiguator/);
 assert.equal((await pool.query('SELECT count(*)::int n FROM nawaa_v2_shadow_outbox WHERE event_id=$1',[id])).rows[0].n,0);
});
