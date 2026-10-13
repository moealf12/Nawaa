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

// Fail closed on pre-existing incompatible objects before creating the ledger or any V2 DDL.
// This covers critical columns; it does not yet constitute a complete schema fingerprint.
const REQUIRED_COLUMNS={
 nawaa_offer_v2:{offer_key:'text',source_id:'text',source_url:'text',condition:'text',product_price:'numeric',currency:'character(3)',observed_at:'timestamp with time zone',payload:'jsonb'},
 nawaa_observation_v2:{id:'bigint',offer_key:'text',ingestion_id:'uuid',source_id:'text',product_price:'numeric',currency:'character(3)',observed_at:'timestamp with time zone'},
 nawaa_v2_receipts:{ingestion_id:'uuid',offer_key:'text',content_digest:'text'},
 nawaa_v2_shadow_outbox:{event_id:'uuid',offer:'jsonb',status:'text',attempts:'integer',max_attempts:'integer',next_attempt_at:'timestamp with time zone',lease_until:'timestamp with time zone',claim_token:'uuid'},
 nawaa_v2_shadow_attempts:{id:'bigint',event_id:'uuid',claim_token:'uuid',attempt:'integer',outcome:'text'},
 nawaa_v2_backfill_progress:{legacy_id:'bigint',outcome:'text',processed_at:'timestamp with time zone'},
 nawaa_schema_migrations:{version:'text',checksum_sha256:'character(64)',applied_at:'timestamp with time zone',applied_by:'text'}
};
async function assertExistingColumns(client){
 for(const [table,expected] of Object.entries(REQUIRED_COLUMNS)){
  // PostgreSQL regclass also resolves views and indexes: require an ordinary or
  // partitioned table, never a name-only substitute.
  const kind=await client.query(`SELECT c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=$1`,[table]);
  if(kind.rows.length && !['r','p'].includes(kind.rows[0].relkind))
   throw new Error('incompatible_existing_schema:'+table+'.object_kind');
  const r=await client.query(`SELECT a.attname AS name,
    pg_catalog.format_type(a.atttypid,a.atttypmod) AS type
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped`,['public.'+table]);
  if(r.rows.length===0){
   const exists=await client.query('SELECT to_regclass($1) AS name',['public.'+table]);
   if(exists.rows[0].name!==null)throw new Error('incompatible_existing_schema:'+table);
   continue;
  }
  const actual=new Map(r.rows.map(x=>[x.name,x.type]));
  for(const [name,type] of Object.entries(expected))
   if(actual.get(name)!==type)throw new Error('incompatible_existing_schema:'+table+'.'+name);
  // Reject objects that have matching columns but lack the required primary key.
  const pk={nawaa_offer_v2:'offer_key',nawaa_observation_v2:'id',
   nawaa_v2_receipts:'ingestion_id',nawaa_v2_shadow_outbox:'event_id',
   nawaa_v2_shadow_attempts:'id',nawaa_v2_backfill_progress:'legacy_id',
   nawaa_schema_migrations:'version'}[table];
  const key=await client.query(`SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=to_regclass($1) AND c.contype='p'`,['public.'+table]);
  if(key.rows.length!==1||key.rows[0].definition!=='PRIMARY KEY ('+pk+')')
   throw new Error('incompatible_existing_schema:'+table+'.primary_key');
  const requiredNotNull={
   nawaa_offer_v2:['offer_key','source_id','source_url','condition','product_price','currency','observed_at','payload'],
   nawaa_observation_v2:['id','offer_key','ingestion_id','source_id','product_price','currency','observed_at'],
   nawaa_v2_receipts:['ingestion_id','offer_key','content_digest'],
   nawaa_v2_shadow_attempts:['id','event_id','claim_token','attempt','outcome'],
   nawaa_v2_shadow_outbox:['event_id','offer','status','attempts','max_attempts','next_attempt_at'],
   nawaa_v2_backfill_progress:['legacy_id','outcome','processed_at'],
   nawaa_schema_migrations:['version','checksum_sha256','applied_at','applied_by']
  }[table];
  const nullable=await client.query(`SELECT attname,attnotnull,attidentity FROM pg_attribute
    WHERE attrelid=to_regclass($1) AND attnum>0 AND NOT attisdropped`,['public.'+table]);
  const metadata=new Map(nullable.rows.map(x=>[x.attname,x]));
  for(const name of requiredNotNull)
   if(!metadata.get(name)?.attnotnull)throw new Error('incompatible_existing_schema:'+table+'.not_null.'+name);
  if(table==='nawaa_observation_v2'||table==='nawaa_v2_shadow_attempts'){
   if(metadata.get('id')?.attidentity!=='a')
    throw new Error('incompatible_existing_schema:'+table+'.identity');
  }
  if(table==='nawaa_offer_v2'||table==='nawaa_observation_v2'){
   const checks=await client.query(`SELECT pg_get_constraintdef(c.oid) AS definition,c.convalidated
     FROM pg_catalog.pg_constraint c WHERE c.conrelid=to_regclass($1) AND c.contype='c'`,['public.'+table]);
   if(!checks.rows.some(c=>c.convalidated&&c.definition==='CHECK ((product_price > (0)::numeric))'))
    throw new Error('incompatible_existing_schema:'+table+'.price_check');
  }
  if(table==='nawaa_observation_v2'){
   const trigger=await client.query(`SELECT t.tgenabled,t.tgtype,
       p.proname,pg_get_functiondef(p.oid) AS function_definition
     FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
     WHERE t.tgrelid='public.nawaa_observation_v2'::regclass AND NOT t.tgisinternal AND t.tgname='nawaa_v2_immutable'`);
   const t=trigger.rows[0];
   if(trigger.rows.length!==1||t.tgenabled!=='O'||
      Number(t.tgtype)!==27||
      t.proname!=='nawaa_v2_reject_observation_change'||
      !t.function_definition.includes("RAISE EXCEPTION 'v2_observations_immutable'"))
    throw new Error('incompatible_existing_schema:'+table+'.immutable_trigger');
  }
  if(table==='nawaa_v2_shadow_outbox'){
   const idx=await client.query(`SELECT i.indisvalid,i.indisready,i.indisunique,
     pg_get_expr(i.indpred,i.indrelid) AS predicate,
     pg_get_indexdef(i.indexrelid) AS definition
     FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
     WHERE i.indrelid='public.nawaa_v2_shadow_outbox'::regclass
       AND c.relname='nawaa_v2_shadow_outbox_expired'`);
   if(idx.rows.length!==1||!idx.rows[0].indisvalid||!idx.rows[0].indisready||
      idx.rows[0].indisunique||idx.rows[0].predicate!=="(status = 'processing'::text)"||
      !/USING btree \(lease_until, event_id\) WHERE/.test(idx.rows[0].definition))
    throw new Error('incompatible_existing_schema:'+table+'.expired_index');
  }
  if(table==='nawaa_observation_v2'){
   const fks=await client.query(`SELECT convalidated, confdeltype, confupdtype, condeferrable,
      pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid=to_regclass($1) AND contype='f'`,['public.'+table]);
   if(!fks.rows.some(x=>x.convalidated&&x.confdeltype==='a'&&x.confupdtype==='a'&&
       !x.condeferrable&&x.definition==='FOREIGN KEY (offer_key) REFERENCES nawaa_offer_v2(offer_key)'))
    throw new Error('incompatible_existing_schema:'+table+'.offer_foreign_key');
  }
  if(table==='nawaa_v2_shadow_attempts'){
   const c=await client.query(`SELECT contype,pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid=to_regclass($1)`,['public.'+table]);
   if(!c.rows.some(x=>x.contype==='u'&&x.def==='UNIQUE (event_id, claim_token)'))
    throw new Error('incompatible_existing_schema:'+table+'.unique_event_claim');
   if(!c.rows.some(x=>x.contype==='f'&&x.def.startsWith('FOREIGN KEY (event_id) REFERENCES nawaa_v2_shadow_outbox(event_id)')))
    throw new Error('incompatible_existing_schema:'+table+'.event_foreign_key');
  }
 }
}

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
  await assertExistingColumns(client);
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

/**
 * Read-only, CI-only post-restore replay gate. This never applies SQL migrations.
 * A restored target has a different database name and must not be passed to the
 * production-shaped rehearsal runner's nawaa_ci-only attestation.
 */
export async function verifyRestoredMigrationReplay(client,{env=process.env}={}){
 assertEphemeralDatabase(env);
 if(!client || typeof client.query!=='function')throw new Error('restore_connection_required');
 const identity=await client.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port");
 if(identity.rowCount!==1||identity.rows[0].db!=='nawaa_restore_ci'||
    identity.rows[0].usr!=='nawaa'||Number(identity.rows[0].port)!==5432)
   throw new Error('restore_target_not_allowlisted');
 await client.query('BEGIN READ ONLY');
 try{
  await client.query("SET LOCAL statement_timeout = '15s'");
  await assertExistingColumns(client);
  const history=await client.query('SELECT version,trim(checksum_sha256) AS checksum FROM nawaa_schema_migrations ORDER BY version');
  const known=V2_MIGRATIONS.map(m=>({version:m.version,checksum:digest(m.sql)}));
  if(JSON.stringify(history.rows)!==JSON.stringify(known))throw new Error('restored_migration_history_diverged');
  await client.query('COMMIT');
  return {applied:[],skipped:known.length,verified:known.length};
 }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
}
