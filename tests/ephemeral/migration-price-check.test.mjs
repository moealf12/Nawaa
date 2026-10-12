import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

test('preexisting offer table without price CHECK fails closed and preserves fixture',async()=>{
 const pool=createEphemeralPool();
 try{
  await pool.query(`CREATE TABLE nawaa_offer_v2(
   offer_key text PRIMARY KEY,source_id text NOT NULL,source_url text NOT NULL,
   condition text NOT NULL,product_price numeric NOT NULL,currency char(3) NOT NULL,
   observed_at timestamptz NOT NULL,payload jsonb NOT NULL)`);
  await pool.query(`INSERT INTO nawaa_offer_v2 VALUES
   ('existing','test','https://example.test/','new',-1,'SAR',now(),'{}'::jsonb)`);
  await assert.rejects(rehearseV2Migrations(pool),/incompatible_existing_schema:nawaa_offer_v2.price_check/);
  const row=await pool.query('SELECT product_price::text AS price FROM nawaa_offer_v2 WHERE offer_key=$1',['existing']);
  assert.equal(row.rows[0].price,'-1');
  const ledger=await pool.query("SELECT to_regclass('public.nawaa_schema_migrations') AS t");
  assert.equal(ledger.rows[0].t,null);
 }finally{await pool.end()}
});
