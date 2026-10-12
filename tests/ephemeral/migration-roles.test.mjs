import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';

// Ephemeral-only least-privilege proof. CI resets public schema before each suite.
// The roles are NOLOGIN and the schema is isolated; production is never contacted.
test('migrator owns DDL; app and verifier cannot mutate schema; verifier cannot write data', async () => {
  assert.equal(process.env.NAWAA_CI_EPHEMERAL_DB, '1');
  assert.match(process.env.DATABASE_URL || '', /^postgres(?:ql)?:\/\/nawaa:nawaa_ci@(?:localhost|127\.0\.0\.1):5432\/nawaa_ci$/);
  const client = new pg.Client({connectionString:process.env.DATABASE_URL,ssl:false});
  await client.connect();
  const suffix=randomUUID().replace(/-/g,'').slice(0,12);
  const schema='ci_priv_'+suffix;
  const migrator='ci_migrator_'+suffix;
  const app='ci_app_'+suffix;
  const worker='ci_worker_'+suffix;
  const verifier='ci_verifier_'+suffix;
  const roles=[migrator,app,worker,verifier];
  const q=s=>client.query(s);
  const asRole=async(role,fn)=>{
    await q('BEGIN');
    try {
      await q('SET LOCAL ROLE "'+role+'"');
      await fn();
    } finally {
      await q('ROLLBACK');
    }
  };
  try {
    for(const role of roles)await q('CREATE ROLE "'+role+'" NOLOGIN');
    await q('CREATE SCHEMA "'+schema+'" AUTHORIZATION "'+migrator+'"');
    await q('REVOKE ALL ON SCHEMA "'+schema+'" FROM PUBLIC');
    for(const role of [app,worker,verifier])await q('GRANT USAGE ON SCHEMA "'+schema+'" TO "'+role+'"');
    await asRole(migrator,async()=>await q('CREATE TABLE "'+schema+'".offers (id integer PRIMARY KEY, price integer NOT NULL)'));
    await q('GRANT SELECT,INSERT,UPDATE ON "'+schema+'".offers TO "'+app+'"');
    await q('GRANT SELECT,UPDATE ON "'+schema+'".offers TO "'+worker+'"');
    await q('GRANT SELECT ON "'+schema+'".offers TO "'+verifier+'"');
    await asRole(app,async()=>{
      await q('INSERT INTO "'+schema+'".offers VALUES (1,100)');
      assert.equal((await q('SELECT price FROM "'+schema+'".offers WHERE id=1')).rows[0].price,100);
      await assert.rejects(q('CREATE TABLE "'+schema+'".forbidden(id int)'),e=>e.code==='42501');
    });
    await asRole(worker,async()=>{
      await assert.rejects(q('CREATE TABLE "'+schema+'".forbidden(id int)'),e=>e.code==='42501');
    });
    await asRole(verifier,async()=>{
      assert.equal((await q('SELECT count(*)::int AS n FROM "'+schema+'".offers')).rows[0].n,0);
      await assert.rejects(q('INSERT INTO "'+schema+'".offers VALUES (2,200)'),e=>e.code==='42501');
    });
    assert.equal((await q('SELECT to_regclass($1) AS tbl',[schema+'.forbidden'])).rows[0].tbl,null);
  }finally{
    await q('RESET ROLE').catch(()=>{});
    await q('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
    for(const role of roles.reverse())await q('DROP ROLE IF EXISTS "'+role+'"').catch(()=>{});
    await client.end();
  }
});
