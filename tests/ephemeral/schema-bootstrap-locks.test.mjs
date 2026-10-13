import test from 'node:test';
import assert from 'node:assert/strict';
import {createEphemeralPool,initV2} from '../../server/persistence-v2.mjs';
import {initShadowOutbox} from '../../server/persistence-v2-outbox.mjs';

const pool=createEphemeralPool();
test.after(async()=>pool.end());

// Holding the exact DDL advisory lock forces both concurrent initializers to
// wait before either creates schema objects. This test fails on an implementation
// that only uses CREATE TABLE IF NOT EXISTS without a transaction-level fence.
async function verifyColdBootstrap({key,initialize,table}) {
  const blocker=await pool.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT pg_advisory_xact_lock($1,$2)',[17033,key]);
  const concurrent=[initialize(),initialize()];
  let waiters=0;
  try{
    const deadline=Date.now()+4000;
    while(Date.now()<deadline && waiters<2) {
      const result=await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database()
          AND wait_event_type='Lock' AND wait_event='advisory'`);
      waiters=result.rows[0].n;
      if(waiters<2)await new Promise(r=>setTimeout(r,30));
    }
    assert.equal(waiters,2,'both schema bootstraps must wait for their DDL fence');
    const before=await pool.query('SELECT to_regclass($1) AS rel',['public.'+table]);
    assert.equal(before.rows[0].rel,null,'schema may not be created before its lock');
  }finally{
    try{await blocker.query('ROLLBACK')}finally{blocker.release()}
  }
  await Promise.all(concurrent);
  const after=await pool.query('SELECT to_regclass($1) IS NOT NULL AS ready',['public.'+table]);
  assert.equal(after.rows[0].ready,true);
}

test('two concurrent cold V2 initializers are serialized without catalog conflict',async()=>{
  await verifyColdBootstrap({key:1,initialize:()=>initV2(pool),table:'nawaa_offer_v2'});
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_v2_receipts') IS NOT NULL AS ready")).rows[0].ready,true);
});

test('two concurrent cold Outbox initializers are serialized without catalog conflict',async()=>{
  await verifyColdBootstrap({key:2,initialize:()=>initShadowOutbox(pool),table:'nawaa_v2_shadow_outbox'});
  assert.equal((await pool.query("SELECT to_regclass('public.nawaa_v2_shadow_attempts') IS NOT NULL AS ready")).rows[0].ready,true);
});
