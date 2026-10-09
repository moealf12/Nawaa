import test from "node:test";
import assert from "node:assert/strict";
import {TRIGRAM_MIGRATION_SQL,assertTrigramOptIn,applyTrigramMigration} from "../server/tooling/trigram.mjs";

test("pg_trgm DDL is opt-in and limited to indexes on existing offer table",()=>{
  assert.equal(TRIGRAM_MIGRATION_SQL.length,3);
  assert.match(TRIGRAM_MIGRATION_SQL[0],/CREATE EXTENSION IF NOT EXISTS pg_trgm/);
  assert.ok(TRIGRAM_MIGRATION_SQL.slice(1).every(sql=>sql.includes("nawaa_offers")&&sql.includes("gin_trgm_ops")));
  assert.throws(()=>assertTrigramOptIn({DATABASE_URL:"postgres://localhost/db"}),/explicit_opt_in/);
  assert.throws(()=>assertTrigramOptIn({NAWAA_ENABLE_TRIGRAM_MIGRATION:"1"}),/database_url_required/);
});
test("pg_trgm migration wraps changes in transaction and does not touch customer search",async()=>{
  const calls=[];
  const client={query:async sql=>{calls.push(sql);return {}}};
  const result=await applyTrigramMigration(client,{env:{DATABASE_URL:"postgres://localhost/db",NAWAA_ENABLE_TRIGRAM_MIGRATION:"1"}});
  assert.deepEqual(result,{installed:true,indexes:2});
  assert.deepEqual(calls,["BEGIN",...TRIGRAM_MIGRATION_SQL,"COMMIT"]);
});
test("pg_trgm migration rolls back if provider denies CREATE EXTENSION",async()=>{
  const calls=[];
  const client={query:async sql=>{calls.push(sql);if(sql.includes("CREATE EXTENSION"))throw new Error("permission denied");}};
  await assert.rejects(applyTrigramMigration(client,{env:{DATABASE_URL:"postgres://localhost/db",NAWAA_ENABLE_TRIGRAM_MIGRATION:"1"}}),/permission denied/);
  assert.deepEqual(calls,["BEGIN",TRIGRAM_MIGRATION_SQL[0],"ROLLBACK"]);
});
