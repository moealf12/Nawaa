// Neon V2 certification runner — isolated QA only. No production wiring.
// Usage: NAWAA_NEON_QA_ONLY=1 NAWAA_NEON_QA_DATABASE_URL=<secret> node scripts/neon-v104-rehearsal.mjs
import {createHash} from 'node:crypto';
import pg from 'pg';
import {V2_MIGRATIONS} from '../server/persistence-v2-migration-rehearsal.mjs';

// Frozen isolated Neon branch endpoint; this runner is deliberately NOT portable
// to the project's main branch. A new QA branch requires a reviewed code change.
const QA_HOST = 'ep-bitter-hall-ba1nrm9e.c-8.eu-central-1.aws.neon.tech';
const DATABASE = 'nawaa_catalog_db';
const EXPECTED = ['v2_0001','v2_0002','v2_0003','v2_0004'];
const digest = sql => createHash('sha256').update(sql,'utf8').digest('hex');

export function attestQaTarget(env=process.env) {
  if(env.NAWAA_NEON_QA_ONLY !== '1') throw new Error('neon_qa_only');
  let url;
  try { url=new URL(env.NAWAA_NEON_QA_DATABASE_URL); } catch { throw new Error('qa_url_required'); }
  if(url.protocol!=='postgresql:' && url.protocol!=='postgres:') throw new Error('qa_protocol_invalid');
  if(url.hostname !== QA_HOST || url.pathname !== '/'+DATABASE || !url.username || !url.password || url.port && url.port!=='5432')
    throw new Error('qa_target_not_allowlisted');
  if(url.searchParams.has('sslmode') && url.searchParams.get('sslmode')!=='verify-full')
    throw new Error('qa_tls_downgrade_rejected');
  if(url.searchParams.has('sslrootcert') || url.searchParams.has('sslcert') || url.searchParams.has('sslkey'))
    throw new Error('qa_custom_certificate_not_reviewed');
  return url.toString();
}

const known=new Map(V2_MIGRATIONS.map(m=>[m.version,digest(m.sql)]));
if(JSON.stringify([...known.keys()])!==JSON.stringify(EXPECTED))throw new Error('migration_versions_changed');

export async function rehearseNeonV2(client,{failAfterVersion=null}={}){
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query('SELECT pg_advisory_xact_lock(17033,40)');
    const identity=(await client.query("SELECT current_database() AS db,current_user AS usr")).rows[0];
    if(identity?.db!==DATABASE || identity?.usr!=='nawaa_catalog_db_owner')throw new Error('qa_session_mismatch');
    // Reject unrecognized objects before applying any migration. The ledger is
    // always checked in its entirety, not just for previously known versions.
    const objects=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    const allowed=new Set(['nawaa_schema_migrations','nawaa_offer_v2','nawaa_observation_v2','nawaa_v2_receipts','nawaa_v2_shadow_outbox','nawaa_v2_shadow_attempts','nawaa_v2_backfill_progress']);
    if(objects.rows.some(r=>!allowed.has(r.tablename)))throw new Error('unexpected_qa_table');
    const ledgerExists=(await client.query("SELECT to_regclass('public.nawaa_schema_migrations') AS object")).rows[0]?.object;
    if(!ledgerExists){
      if(objects.rows.length)throw new Error('untracked_preexisting_qa_schema');
      await client.query("CREATE TABLE nawaa_schema_migrations(version text PRIMARY KEY,checksum_sha256 char(64) NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),applied_by text NOT NULL)");
    }
    const entries=(await client.query('SELECT version,trim(checksum_sha256) AS checksum FROM nawaa_schema_migrations ORDER BY version')).rows;
    let gap=false;
    for(const entry of entries){
      if(known.get(entry.version)!==entry.checksum)throw new Error('migration_history_diverged');
    }
    const applied=new Set(entries.map(x=>x.version));
    for(const m of V2_MIGRATIONS){
      if(!applied.has(m.version))gap=true;
      else if(gap)throw new Error('migration_version_gap');
    }
    const newVersions=[];
    for(const m of V2_MIGRATIONS){
      if(applied.has(m.version))continue;
      await client.query(m.sql);
      if(failAfterVersion===m.version)throw new Error('injected_after_ddl');
      await client.query('INSERT INTO nawaa_schema_migrations(version,checksum_sha256,applied_by) VALUES ($1,$2,$3)',[m.version,known.get(m.version),'neon-v104-qa-only']);
      newVersions.push(m.version);
    }
    const count=(await client.query('SELECT count(*)::int AS n FROM nawaa_schema_migrations')).rows[0].n;
    if(count!==EXPECTED.length)throw new Error('ledger_incomplete');
    await client.query('COMMIT');
    return {applied:newVersions,skipped:EXPECTED.length-newVersions.length,ledgerVersions:count};
  }catch(e){try{await client.query('ROLLBACK')}catch{}throw e}
}

if(process.argv[1]?.endsWith('/neon-v104-rehearsal.mjs')){
  const connectionString=attestQaTarget();
  // Explicit TLS certificate/hostname validation through Node TLS.
  const pool=new pg.Pool({connectionString,ssl:{rejectUnauthorized:true},max:1,connectionTimeoutMillis:10000});
  try{
    const client=await pool.connect();
    try{
      // Do not trust the URL alone: inspect the TLS socket exposed by node-postgres.
      const stream=client.connection?.stream;
      if(!stream?.encrypted || stream.authorized!==true || stream.servername!==QA_HOST)
        throw new Error('verified_tls_socket_required');
      const result=await rehearseNeonV2(client);
      process.stdout.write(JSON.stringify(result)+'\n');
    }finally{client.release()}
  }catch(error){process.stderr.write('neon_qa_certification_failed:'+error.message+'\n');process.exitCode=1}
  finally{await pool.end()}
}
