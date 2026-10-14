import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {initPersistence,recordOffer,persistOffers,searchPersistedOffers} from '../../server/persistence.mjs';

const pool=createEphemeralPool();
await initPersistence();
test.after(async()=>pool.end());
const base=(id,changes={})=>({
  title:'HP Laptop 14 Gen10',
  sourceUrl:'https://www.jarir.com/sa/ci/provenance/'+id,
  sourceName:'jarir',
  merchant:'Jarir',
  currency:'SAR',
  productPrice:2499,
  condition:'new',
  observedAt:new Date(Date.now()-3*3600_000).toISOString(),
  ...changes,
});
const keyOf=o=>o.sourceUrl.replace('www.jarir.com','jarir.com')+'|new';

test('persistOffers retains source observation time and older late arrivals cannot overwrite newer evidence',async()=>{
  const first=base(randomUUID()),newer={...first,observedAt:new Date(Date.now()-30_000).toISOString(),productPrice:2300};
  assert.equal((await persistOffers('HP',[first])).saved,1);
  let row=(await pool.query('SELECT product_price,observed_at,payload FROM nawaa_offers WHERE offer_key=$1',[keyOf(first)])).rows[0];
  assert.equal(new Date(row.observed_at).toISOString(),first.observedAt,'index/write time must not replace the original observation time');
  await persistOffers('HP',[newer]);
  await persistOffers('HP',[first]); // late write of older price
  row=(await pool.query('SELECT product_price,observed_at,payload FROM nawaa_offers WHERE offer_key=$1',[keyOf(first)])).rows[0];
  assert.equal(Number(row.product_price),2300);
  assert.equal(new Date(row.observed_at).toISOString(),newer.observedAt);
  assert.equal(row.payload.productPrice,2300);
});

test('equal observation times are deterministic: first canonical price wins',async()=>{
  const first=base(randomUUID(),{productPrice:2200});
  const conflicting={...first,productPrice:1100};
  await recordOffer(first);
  await recordOffer(conflicting);
  const row=(await pool.query('SELECT product_price,payload FROM nawaa_offers WHERE offer_key=$1',[keyOf(first)])).rows[0];
  assert.equal(Number(row.product_price),2200,'equal-timestamp conflict must retain first writer');
  assert.equal(row.payload.productPrice,2200);
  assert.equal((await pool.query('SELECT count(*)::int n FROM offer_observations WHERE product_url=$1',[keyOf(first).slice(0,-4)])).rows[0].n,2,
    'legacy non-shadow writer permits distinct historical observations; no false idempotency claim');
});

test('recordOffer rejects missing malformed and future observation time before insertion',async()=>{
  const id=randomUUID(),src=base(id);
  for(const observedAt of [undefined,'nonsense',new Date(Date.now()+3600_000).toISOString()]){
    await assert.rejects(recordOffer({...src,observedAt}),/invalid_observed_at/);
  }
  const count=await pool.query('SELECT count(*)::int n FROM nawaa_offers WHERE offer_key=$1',[keyOf(src)]);
  assert.equal(count.rows[0].n,0);
});

test('persistOffers rejects unverified FX, retaining valid same-currency evidence',async()=>{
  const id=randomUUID(),src=base(id,{originalCurrency:'USD',originalProductPrice:500});
  const invalid={...src,fx:undefined};
  await assert.rejects(persistOffers('HP',[invalid]),/invalid_price_evidence/);
  const same=base(randomUUID());
  assert.equal((await persistOffers('HP',[same])).saved,1);
  const converted={...src,productPrice:1875,fx:{rate:3.75,source:'Frankfurter',observedAt:new Date(Date.now()-3600_000).toISOString()}};
  assert.equal((await persistOffers('HP',[converted])).saved,1);
  const row=(await pool.query('SELECT payload FROM nawaa_offers WHERE offer_key=$1',[keyOf(src)])).rows[0];
  assert.equal(row.payload.originalCurrency,'USD');
  assert.equal(row.payload.originalProductPrice,500);
  assert.equal(row.payload.fx.rate,3.75);
});

test('direct dormant recall rejects forged recency and retains valid alternative at requested limit',async()=>{
  const good=base(randomUUID(),{title:'HP Laptop Alternative',productPrice:1800,observedAt:new Date(Date.now()-60_000).toISOString()});
  await persistOffers('HP', [good]);
  const bad=base(randomUUID(),{title:'HP Laptop Forged',productPrice:1,observedAt:new Date(Date.now()-24*3600_000).toISOString()});
  await pool.query(`INSERT INTO nawaa_offers(offer_key,query,title,source_url,currency,product_price,condition,observed_at,payload)
    VALUES($1,'HP','HP Laptop Forged',$2,'SAR',1,'new',now(),$3::jsonb)`,
    [keyOf(bad),bad.sourceUrl.replace('www.jarir.com','jarir.com'),JSON.stringify(bad)]);
  const result=await searchPersistedOffers('HP',{limit:1});
  assert.equal(result.offers.length,1);
  assert.equal(result.offers[0].productPrice,1800);
  assert.equal(result.offers[0].dataKind,'persisted');
  assert.equal(result.offers[0].availability,'unknown');
  assert.equal(result.offers[0].priceConfidence,'incomplete');
  assert.equal(result.offers[0].totalSAR,null);
});
