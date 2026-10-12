import {createHash} from 'node:crypto';
import {assertEphemeralDatabase,attestEphemeralConnection,CREATE_V2_SQL} from './persistence-v2.mjs';

// CI rehearsal only. This runner cannot target production without a separate implementation.
export const V2_MIGRATIONS=[
 {version:'v2_0001',sql:CREATE_V2_SQL},
 {version:'v2_0002',sql:`CREATE TABLE IF NOT EXISTS nawaa_v2_receipts(
 ingestion_id uuid PRIMARY KEY,offer_key text NOT NULL,content_digest text NOT NULL);`},
 {version:'v2_0003',sql:`CREATE TABLE IF NOT EXISTS nawaa_v2_shadow_outbox(
 event_id uuid PRIMARY KEY,offer jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','dead')),
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 3,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,
 claim_token uuid,last_error text,created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz);
 CREATE TABLE IF NOT EXISTS nawaa_v2_shadow_attempts(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_id uuid NOT NULL REFERENCES nawaa_v2_shadow_outbox(event_id),
 claim_token uuid NOT NULL,attempt integer NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('completed','retry','dead','stale')),
 error text,recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,claim_token));
 CREATE INDEX IF NOT EXISTS nawaa_v2_shadow_attempts_event ON nawaa_v2_shadow_attempts(event_id,recorded_at);
 CREATE INDEX IF NOT EXISTS nawaa_v2_shadow_outbox_ready ON nawaa_v2_shadow_outbox(status,next_attempt_at);
 CREATE INDEX IF NOT EXISTS nawaa_v2_shadow_outbox_expired ON nawaa_v2_shadow_outbox(lease_until,event_id) WHERE status='processing';`},
 {version:'v2_0004',sql:`CREATE TABLE IF NOT EXISTS nawaa_v2_backfill_progress(
 legacy_id bigint PRIMARY KEY,outcome text NOT NULL CHECK(outcome IN ('copied','unresolved')),
 processed_at timestamptz NOT NULL DEFAULT now());`}
];
const digest=sql=>createHash('sha256').update(sql).digest('hex');
export async function rehearseV2Migrations(pool,{env=process.env,failVersion=null}={}){
 assertEphemeralDatabase(env);
 const client=await pool.connect();
 try{
  await attestEphemeralConnection(client,{env});
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query('SELECT pg_advisory_xact_lock($1,$2)',[17033,40]);
  await client.query(`CREATE TABLE IF NOT EXISTS nawaa_schema_migrations(
    version text PRIMARY KEY,checksum_sha256 char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),applied_by text NOT NULL)`);
  const history=await client.query('SELECT version,checksum_sha256 FROM nawaa_schema_migrations ORDER BY version');
  const known=new Map(V2_MIGRATIONS.map(m=>[m.version,digest(m.sql)]));
  for(const row of history.rows){
   if(!known.has(row.version)||known.get(row.version)!==row.checksum_sha256.trim())
    throw new Error('migration_history_diverged');
  }
  const applied=new Set(history.rows.map(r=>r.version));
  // A later migration may never exist without every earlier version.
  let missing=false;
  for(const m of V2_MIGRATIONS){
   if(!applied.has(m.version))missing=true;
   else if(missing)throw new Error('migration_version_gap');
  }
  const newlyApplied=[];
  for(const m of V2_MIGRATIONS){
   if(applied.has(m.version))continue;
   await client.query(m.sql);
   if(failVersion===m.version)throw new Error('injected_migration_failure');
   await client.query('INSERT INTO nawaa_schema_migrations(version,checksum_sha256,applied_by) VALUES($1,$2,$3)',[m.version,digest(m.sql),'ci-rehearsal']);
   newlyApplied.push(m.version);
  }
  await client.query('COMMIT');
  return {applied:newlyApplied,skipped:V2_MIGRATIONS.length-newlyApplied.length};
 }catch(e){
  try{await client.query('ROLLBACK')}catch{}
  throw e;
 }finally{client.release()}
}
