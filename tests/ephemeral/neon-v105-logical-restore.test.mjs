// Integration: restore synthetic Neon QA export into owned CI PostgreSQL.
// No Neon credentials; no production database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEphemeralPool,attestEphemeralConnection} from '../../server/persistence-v2.mjs';
import {V2_MIGRATIONS,rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

const snapshot=JSON.parse(readFileSync(new URL('../fixtures/neon-v104-synthetic-export.json',import.meta.url),'utf8'));
const order=[
  ['nawaa_offer_v2','offer_key',false],
  ['nawaa_observation_v2','id',true],
  ['nawaa_v2_receipts','ingestion_id',false],
  ['nawaa_v2_shadow_outbox','event_id',false],
  ['nawaa_v2_shadow_attempts','id',true],
  ['nawaa_v2_backfill_progress','legacy_id',false],
  ['nawaa_schema_migrations','version',false],
];
const allowedNames=new Set(order.map(([t])=>t));
assert.equal(snapshot.source_branch_id,'br-long-snow-ba2k3bkj');
assert.equal(snapshot.tables.nawaa_offer_v2?.[0]?.offer_key,'v104-test-only');
assert.deepEqual(Object.keys(snapshot.tables).sort(),[...allowedNames].sort());

async function restore(client,{injectFailure=false}={}){
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query('SELECT pg_advisory_xact_lock($1,$2)',[17033,40]);
    const current=(await client.query('SELECT current_database() AS db,current_user AS usr')).rows[0];
    if(current?.db!=='nawaa_ci'||current?.usr!=='nawaa')throw Error('ci_target_not_allowlisted');
    if((await client.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n!==0)
      throw Error('restore_target_not_empty');
    await client.query('CREATE TABLE nawaa_schema_migrations(version text PRIMARY KEY,checksum_sha256 char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),applied_by text NOT NULL)');
    for(const m of V2_MIGRATIONS)await client.query(m.sql);
    for(const [table,_pk,identity] of order){
      if(!allowedNames.has(table))throw Error('unexpected_table');
      const json=JSON.stringify(snapshot.tables[table]);
      if(!Array.isArray(snapshot.tables[table]))throw Error('invalid_export');
      await client.query(
        'INSERT INTO public.'+table+(identity?' OVERRIDING SYSTEM VALUE':'')+
        ' SELECT * FROM jsonb_populate_recordset(NULL::public.'+table+',$1::jsonb)',
        [json]
      );
    }
    // Transactional identity restart; never use non-transactional setval.
    await client.query('ALTER SEQUENCE nawaa_observation_v2_id_seq RESTART WITH 2');
    await client.query('ALTER SEQUENCE nawaa_v2_shadow_attempts_id_seq RESTART WITH 2');
    if(injectFailure)throw Error('injected_restore_after_all_rows_before_commit');
    await client.query('COMMIT');
  }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
}

function aggregateSQL(){
  const pairs=order.map(([table,key])=>
    "'"+table+"',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY "+key+"),'[]'::jsonb) FROM public."+table+" x)");
  return 'WITH e AS (SELECT jsonb_build_object('+pairs.join(',')+
    ") AS payload) SELECT encode(sha256(convert_to(payload::text,'UTF8')),'hex') AS sha256 FROM e";
}

test('independent synthetic Neon export restores exactly; failures rollback',async()=>{
  const pool=createEphemeralPool();
  const client=await pool.connect();
  try {
    await attestEphemeralConnection(client);
    await assert.rejects(restore(client,{injectFailure:true}),/injected_restore_after_all_rows_before_commit/);
    const absent=await client.query("SELECT to_regclass('public.nawaa_offer_v2') AS offers,to_regclass('public.nawaa_schema_migrations') AS ledger");
    assert.equal(absent.rows[0].offers,null);
    assert.equal(absent.rows[0].ledger,null);
    await restore(client);
    const fingerprint=await client.query(aggregateSQL());
    assert.equal(fingerprint.rows[0].sha256,snapshot.canonical_postgres_jsonb_sha256);
    const replay1=await rehearseV2Migrations(pool);
    const replay2=await rehearseV2Migrations(pool);
    assert.deepEqual(replay1,{applied:[],skipped:4});
    assert.deepEqual(replay2,{applied:[],skipped:4});
    assert.equal((await client.query('SELECT last_value FROM nawaa_observation_v2_id_seq')).rows[0].last_value,'2');
    assert.equal((await client.query('SELECT is_called FROM nawaa_observation_v2_id_seq')).rows[0].is_called,false);
    await assert.rejects(client.query("UPDATE nawaa_observation_v2 SET product_price=1 WHERE offer_key='v104-test-only'"),/v2_observations_immutable/);
  }finally {client.release();await pool.end()}
});
