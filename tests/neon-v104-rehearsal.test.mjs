import test from 'node:test';
import assert from 'node:assert/strict';
import {attestQaTarget,rehearseNeonV2} from '../scripts/neon-v104-rehearsal.mjs';

const target='postgresql://tester:test@ep-bitter-hall-ba1nrm9e.c-8.eu-central-1.aws.neon.tech/nawaa_catalog_db';
test('QA connection requires exact isolated host, opt-in and credentialed URL',()=>{
  assert.throws(()=>attestQaTarget({NAWAA_NEON_QA_DATABASE_URL:target}),/neon_qa_only/);
  assert.throws(()=>attestQaTarget({NAWAA_NEON_QA_ONLY:'1',NAWAA_NEON_QA_DATABASE_URL:target.replace('ep-bitter-hall-ba1nrm9e','ep-production')}),/qa_target_not_allowlisted/);
  assert.throws(()=>attestQaTarget({NAWAA_NEON_QA_ONLY:'1',NAWAA_NEON_QA_DATABASE_URL:target+'?sslmode=disable'}),/qa_tls_downgrade_rejected/);
  assert.equal(new URL(attestQaTarget({NAWAA_NEON_QA_ONLY:'1',NAWAA_NEON_QA_DATABASE_URL:target})).hostname,'ep-bitter-hall-ba1nrm9e.c-8.eu-central-1.aws.neon.tech');
});

class FakeClient {
  constructor(){this.rows=[];this.tables=new Set();this.queryLog=[];this.snapshot=null}
  async query(query,params=[]){
    const sql=String(query);this.queryLog.push(sql);
    if(sql==='BEGIN'){this.snapshot={rows:this.rows.map(r=>({...r})),tables:new Set(this.tables)};return {rows:[]}}
    if(sql==='COMMIT'){this.snapshot=null;return {rows:[]}}
    if(sql==='ROLLBACK'){this.rows=this.snapshot.rows;this.tables=this.snapshot.tables;this.snapshot=null;return {rows:[]}}
    if(sql.includes("current_database() AS db"))return {rows:[{db:'nawaa_catalog_db',usr:'nawaa_catalog_db_owner'}]};
    if(sql.includes('FROM pg_tables'))return {rows:[...this.tables].map(tablename=>({tablename}))};
    if(sql.includes("to_regclass('public.nawaa_schema_migrations')"))return {rows:[{object:this.tables.has('nawaa_schema_migrations')?'nawaa_schema_migrations':null}]};
    if(sql.startsWith('CREATE TABLE nawaa_schema_migrations')){this.tables.add('nawaa_schema_migrations');return {rows:[]}}
    if(sql.startsWith('SELECT version,trim(checksum_sha256)'))return {rows:this.rows.map(r=>({...r,checksum:r.checksum_sha256})).sort((a,b)=>a.version.localeCompare(b.version))};
    if(sql.startsWith('INSERT INTO nawaa_schema_migrations')){this.rows.push({version:params[0],checksum_sha256:params[1]});return {rows:[]}}
    if(sql.startsWith('SELECT count(*)::int AS n FROM nawaa_schema_migrations'))return {rows:[{n:this.rows.length}]};
    // The actual DDL is validated separately against Neon PostgreSQL 17.
    for(const name of sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(nawaa_[a-z0-9_]+)/gi))this.tables.add(name[1]);
    return {rows:[]};
  }
}
test('runner applies versioned ledger once and replays idempotently',async()=>{
  const db=new FakeClient();
  const first=await rehearseNeonV2(db);
  assert.deepEqual(first,{applied:['v2_0001','v2_0002','v2_0003','v2_0004'],skipped:0,ledgerVersions:4});
  const second=await rehearseNeonV2(db);
  assert.deepEqual(second,{applied:[],skipped:4,ledgerVersions:4});
  assert.equal(db.rows.length,4);
  assert.equal(db.queryLog.filter(s=>s.includes('pg_advisory_xact_lock')).length,2);
});
test('failure injected after DDL rolls back ledger and schema together',async()=>{
  const db=new FakeClient();
  await assert.rejects(rehearseNeonV2(db,{failAfterVersion:'v2_0002'}),/injected_after_ddl/);
  assert.equal(db.rows.length,0);
  assert.equal(db.tables.size,0);
});
test('unknown migration, checksum drift and sequence gaps fail closed',async()=>{
  for(const mutation of [
    db=>db.rows.push({version:'v2_9999',checksum_sha256:'0'.repeat(64)}),
    db=>db.rows[1].checksum_sha256='0'.repeat(64),
    db=>db.rows.splice(1,1),
  ]){
    const db=new FakeClient();
    await rehearseNeonV2(db);
    mutation(db);
    const before=JSON.stringify({rows:db.rows,tables:[...db.tables]});
    await assert.rejects(rehearseNeonV2(db),/migration_history_diverged|migration_version_gap/);
    assert.equal(JSON.stringify({rows:db.rows,tables:[...db.tables]}),before);
    assert.equal(db.queryLog.at(-1),'ROLLBACK');
  }
});
test('rejects unknown preexisting tables on QA endpoint',async()=>{
  const db=new FakeClient();db.tables.add('other_product_table');
  await assert.rejects(rehearseNeonV2(db),/unexpected_qa_table/);
  assert.equal(db.queryLog.at(-1),'ROLLBACK');
});
