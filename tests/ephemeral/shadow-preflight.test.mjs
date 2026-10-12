import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

test('invalid shadow target fails before any legacy DDL on wrong database',async()=>{
  const wrongUrl=process.env.DATABASE_URL.replace(/\/nawaa_ci$/,'/postgres');
  const pool=new pg.Pool({connectionString:wrongUrl,ssl:false});
  const check=()=>pool.query("SELECT to_regclass('public.nawaa_offers') AS legacy, to_regclass('public.offer_observations') AS history");
  try{
    const before=(await check()).rows[0];
    // A clean wrong-target DB is required to prove both tables stay absent.
    assert.equal(before.legacy,null);
    assert.equal(before.history,null);
    const script=`
      import {recordOffer} from './server/persistence.mjs';
      try {
        await recordOffer({sourceUrl:'https://example.com/item/${randomUUID()}',title:'Shadow rejection regression',productPrice:100,currency:'SAR'});
        process.exitCode=1;
      } catch(error) {
        if(error.message!=='ephemeral_database_only') { console.error(error); process.exitCode=2; }
      }
    `;
    execFileSync(process.execPath,['--input-type=module','-e',script],{
      cwd:process.cwd(),
      env:{...process.env,DATABASE_URL:wrongUrl,NAWAA_LEGACY_OUTBOX_SHADOW:'1',NAWAA_CI_EPHEMERAL_DB:'1',DATABASE_SSL:'false'},
      timeout:10000,
    });
    const after=(await check()).rows[0];
    assert.deepEqual(after,before);
  }finally{await pool.end();}
});
