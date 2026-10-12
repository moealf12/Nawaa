import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
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
 await source.query("INSERT INTO nawaa_v2_receipts(ingestion_id,offer_key,content_digest) VALUES('00000000-0000-0000-0000-000000000097','recovery-test','sha256:fixture')");
 await source.query("INSERT INTO nawaa_v2_shadow_outbox(event_id,offer) VALUES('00000000-0000-0000-0000-000000000098','{}'::jsonb)");
 await source.query("INSERT INTO nawaa_v2_shadow_attempts(event_id,claim_token,attempt,outcome) VALUES('00000000-0000-0000-0000-000000000098','00000000-0000-0000-0000-000000000099',1,'retry')");
 const snapshot=async(client)=>{
  const result={};
  for(const table of ['nawaa_schema_migrations','nawaa_v2_receipts','nawaa_v2_shadow_outbox','nawaa_v2_shadow_attempts']){
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
 const versions=await restoredClient.query('SELECT version FROM nawaa_schema_migrations ORDER BY version');
 if(versions.rows.map(x=>x.version).join(',')!=='v2_0001,v2_0002,v2_0003,v2_0004')throw Error('restored_ledger_invalid');
 process.stdout.write('isolated_restore_verified tables=4 migration_versions=4\n');
}finally{
 if(restoredClient)await restoredClient.end();
 const exists=await source.query('SELECT 1 FROM pg_database WHERE datname=$1',[target]);
 if(exists.rowCount)await source.query('DROP DATABASE '+target+' WITH (FORCE)');
 await source.end();
 await rm(directory,{recursive:true,force:true});
}
