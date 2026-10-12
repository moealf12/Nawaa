import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {V2_MIGRATIONS,verifyRestoredMigrationReplay} from '../../server/persistence-v2-migration-rehearsal.mjs';
import {assertEphemeralDatabase,createEphemeralPool} from '../../server/persistence-v2.mjs';
import {rehearseV2Migrations} from '../../server/persistence-v2-migration-rehearsal.mjs';

assertEphemeralDatabase(process.env);
const source=createEphemeralPool();
const directory=await mkdtemp(join(tmpdir(),'nawaa-restore-'));
const dump=join(directory,'ci.dump');
const target='nawaa_restore_ci';
const root=process.env.DATABASE_URL;
const restored=root.replace(/\/nawaa_ci$/,'/'+target);
const credentials={...process.env,PGPASSWORD:'nawaa_ci'};
const run=(bin,args)=>execFileSync(bin,args,{env:credentials,stdio:'pipe',timeout:120000});
let restoredClient;
try{
 run('pg_dump',['--version']);
 run('pg_restore',['--version']);
 await rehearseV2Migrations(source);
 await source.query(`INSERT INTO nawaa_offer_v2(offer_key,source_id,source_url,condition,product_price,currency,observed_at,payload)
 VALUES('restore-offer','restore-source','https://example.test/item','new',1499.50,'SAR','2026-10-12T12:00:00Z','{"sku":"restore-test","title":"Sample product"}'::jsonb)`);
 await source.query(`INSERT INTO nawaa_observation_v2(offer_key,ingestion_id,source_id,product_price,currency,observed_at)
 VALUES('restore-offer','00000000-0000-4000-8000-000000000096','restore-source',1499.50,'SAR','2026-10-12T12:00:00Z')`);
 await source.query("INSERT INTO nawaa_v2_receipts(ingestion_id,offer_key,content_digest) VALUES('00000000-0000-0000-0000-000000000097','recovery-test','sha256:fixture')");
 await source.query("INSERT INTO nawaa_v2_shadow_outbox(event_id,offer) VALUES('00000000-0000-0000-0000-000000000098','{}'::jsonb)");
 await source.query("INSERT INTO nawaa_v2_shadow_attempts(event_id,claim_token,attempt,outcome) VALUES('00000000-0000-0000-0000-000000000098','00000000-0000-0000-0000-000000000099',1,'retry')");
 const snapshot=async(client)=>{
  const result={};
  for(const table of ['nawaa_offer_v2','nawaa_observation_v2','nawaa_schema_migrations','nawaa_v2_receipts','nawaa_v2_shadow_outbox','nawaa_v2_shadow_attempts']){
   const r=await client.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text),'')) AS digest FROM (SELECT * FROM ${table}) t`);
   result[table]=r.rows[0];
  }
  return result;
 };
 const expected=await snapshot(source);
 const exists=await source.query('SELECT 1 FROM pg_database WHERE datname=$1',[target]);
 if(exists.rowCount)throw Error('restore_target_already_exists');
 await source.query('CREATE DATABASE '+target);
 run('pg_dump',['--format=custom','--no-owner','--no-privileges','--dbname',root,'--file',dump]);
 run('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--dbname',restored,dump]);
 restoredClient=new pg.Client({connectionString:restored,ssl:false});
 await restoredClient.connect();
 const actual=await snapshot(restoredClient);
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('restored_snapshot_mismatch');
 const invariant=await restoredClient.query(`SELECT
 (SELECT count(*) FROM pg_trigger WHERE tgrelid='nawaa_observation_v2'::regclass AND tgname='nawaa_v2_immutable' AND tgenabled='O') AS triggers,
 (SELECT count(*) FROM pg_constraint WHERE conrelid='nawaa_observation_v2'::regclass AND contype='f') AS foreign_keys,
 (SELECT count(*) FROM pg_constraint WHERE conrelid='nawaa_observation_v2'::regclass AND contype='u') AS unique_keys`);
 if(Number(invariant.rows[0].triggers)!==1||Number(invariant.rows[0].foreign_keys)!==1||Number(invariant.rows[0].unique_keys)!==1)throw Error('restored_schema_invariant_missing');
 // Behavioral evidence: restored observation rows must reject both mutations.
 const original=await restoredClient.query('SELECT id,product_price FROM nawaa_observation_v2 ORDER BY id');
 for(const sql of ["UPDATE nawaa_observation_v2 SET product_price=1 WHERE id=$1","DELETE FROM nawaa_observation_v2 WHERE id=$1"]){
  let rejected=false;
  try{await restoredClient.query(sql,[original.rows[0].id])}catch(error){rejected=error.message.includes('v2_observations_immutable')}
  if(!rejected)throw Error('restored_observation_mutation_not_rejected');
 }
 const unchanged=await restoredClient.query('SELECT id,product_price FROM nawaa_observation_v2 ORDER BY id');
 if(JSON.stringify(unchanged.rows)!==JSON.stringify(original.rows))throw Error('restored_observation_was_modified');
 // A restored receipt cannot be duplicated, and a broken observation FK is rejected.
 for(const [sql,code] of [
  ["INSERT INTO nawaa_v2_receipts(ingestion_id,offer_key,content_digest) VALUES('00000000-0000-0000-0000-000000000097','duplicate','digest')",'23505'],
  ["INSERT INTO nawaa_observation_v2(offer_key,ingestion_id,source_id,product_price,currency,observed_at) VALUES('missing-offer','00000000-0000-4000-8000-000000000095','source',12,'SAR',now())",'23503']
 ]){
  let rejected=false;
  try{await restoredClient.query(sql)}catch(error){rejected=error.code===code}
  if(!rejected)throw Error('restored_constraint_not_enforced:'+code);
 }
 const versions=await restoredClient.query('SELECT version FROM nawaa_schema_migrations ORDER BY version');
 if(versions.rows.map(x=>x.version).join(',')!=='v2_0001,v2_0002,v2_0003,v2_0004')throw Error('restored_ledger_invalid');
 const ledger=await restoredClient.query('SELECT version,trim(checksum_sha256) AS checksum FROM nawaa_schema_migrations ORDER BY version');
 const expectedLedger=V2_MIGRATIONS.map(m=>({version:m.version,checksum:createHash('sha256').update(m.sql).digest('hex')}));
 if(JSON.stringify(ledger.rows)!==JSON.stringify(expectedLedger))throw Error('restored_migration_checksum_mismatch');
 const replay=await verifyRestoredMigrationReplay(restoredClient);
 if(replay.applied.length!==0||replay.skipped!==4)throw Error('restored_replay_not_idempotent');
 let wrongTargetRejected=false;
 try{await verifyRestoredMigrationReplay(source)}catch(error){wrongTargetRejected=error.message==='restore_target_not_allowlisted'}
 if(!wrongTargetRejected)throw Error('restore_allowlist_not_enforced');
 // Replay the ACTUAL runner against a fresh restored copy in the runner's
 // existing exact allowlisted nawaa_ci database. The CI PostgreSQL service
 // is disposable and its connection is attested by rehearseV2Migrations().
 const restoreReplayStarted=Date.now();
 const replayCopy=join(directory,'replay.dump');
 run('pg_dump',['--format=custom','--no-owner','--no-privileges','--dbname',restored,'--file',replayCopy]);
 await source.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
 run('pg_restore',['--no-owner','--no-privileges','--exit-on-error','--dbname',root,replayCopy]);
 const replayBaseline=await snapshot(source);
 if(JSON.stringify(replayBaseline)!==JSON.stringify(expected))throw Error('replay_copy_mismatch');
 const sequenceBaseline=await source.query(`SELECT schemaname, sequencename, start_value, min_value, max_value, increment_by, cycle, cache_size, last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`);
 for(let iteration=0;iteration<2;iteration++){
  const actualReplay=await rehearseV2Migrations(source);
  if(actualReplay.applied.length!==0||actualReplay.skipped!==4)throw Error('actual_runner_replay_not_idempotent');
  if(JSON.stringify(await snapshot(source))!==JSON.stringify(replayBaseline))throw Error('actual_runner_changed_data');
  const sequences=await source.query(`SELECT schemaname, sequencename, start_value, min_value, max_value, increment_by, cycle, cache_size, last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename`);
  if(JSON.stringify(sequences.rows)!==JSON.stringify(sequenceBaseline.rows))throw Error('actual_runner_changed_sequences');
 }
 const actualReplayMs=Date.now()-restoreReplayStarted;
 const postChecks=await snapshot(restoredClient);
 if(JSON.stringify(postChecks)!==JSON.stringify(expected))throw Error('restored_integrity_changed_during_checks');

 process.stdout.write('isolated_restore_verified tables=6 migration_versions=4 schema_invariants=3 immutability=2 constraints=2 ledger_checksums=4 replay_applied=0 unauthorized_target_rejected=1 actual_runner_replays=2 actual_runner_applied=0\n');
}finally{
 if(restoredClient)await restoredClient.end();
 const exists=await source.query('SELECT 1 FROM pg_database WHERE datname=$1',[target]);
 if(exists.rowCount)await source.query('DROP DATABASE '+target+' WITH (FORCE)');
 await source.end();
 await rm(directory,{recursive:true,force:true});
}
