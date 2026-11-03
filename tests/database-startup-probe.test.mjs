import test from "node:test";
import assert from "node:assert/strict";
import {probeDatabaseOnStartup} from "../server/database-startup-probe.mjs";

test("database probe stays dormant unless explicitly enabled",async()=>{
  const logs=[];
  const result=await probeDatabaseOnStartup({env:{DATABASE_URL:"postgresql://secret"},
    log:(line)=>logs.push(line)});
  assert.deepEqual(result,{skipped:true});
  assert.equal(logs.length,0);
});

test("database probe reports missing connection without exposing environment",async()=>{
  const logs=[];
  const result=await probeDatabaseOnStartup({env:{NAWAA_DATABASE_PROBE:"1"},
    log:(line)=>logs.push(line),clock:()=>0});
  assert.equal(result.ready,false);
  assert.equal(result.reason,"not_configured");
  assert.equal(logs.length,1);
});

test("database probe verifies read, rolled-back write and zero residual records",async()=>{
  const calls=[],logs=[];
  class FakeClient {
    constructor(config) {
      assert.equal(config.connectionString,"postgresql://user:secret@host/db");
      assert.equal(config.ssl.rejectUnauthorized,true);
      assert.equal(config.connectionTimeoutMillis,4000);
    }
    async connect(){calls.push("connect");}
    async query(sql,params){
      calls.push(sql);
      if (sql.startsWith("SELECT 1")) return {rows:[{ok:1}]};
      if (sql.startsWith("SELECT COUNT")) {
        assert.equal(params[0],"__nawaa_storage_probe__:test-id");
        return {rows:[{remaining:0}]};
      }
      return {rows:[]};
    }
    async end(){calls.push("end");}
  }
  const result=await probeDatabaseOnStartup({
    env:{NAWAA_DATABASE_PROBE:"1",DATABASE_URL:"postgresql://user:secret@host/db"},
    Client:FakeClient,log:(line)=>logs.push(line),clock:()=>100,id:()=>"test-id",
  });
  assert.equal(result.ready,true);
  assert.equal(result.writeRollback,true);
  assert.ok(calls.some(s=>s.startsWith("INSERT INTO nawaa_offers")));
  assert.ok(calls.includes("ROLLBACK"));
  assert.equal(calls.at(-1),"end");
  assert.ok(!logs.join("\n").includes("secret"));
});

test("database probe catches write failure and still rolls back without leaks",async()=>{
  const calls=[],logs=[];
  class FailingClient {
    async connect(){calls.push("connect");}
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("SELECT 1")) return {rows:[{ok:1}]};
      if (sql.startsWith("INSERT")) throw new Error("driver error with postgresql://secret");
      return {rows:[]};
    }
    async end(){calls.push("end");}
  }
  const result=await probeDatabaseOnStartup({
    env:{NAWAA_DATABASE_PROBE:"1",DATABASE_URL:"postgresql://secret"},
    Client:FailingClient,log:(line)=>logs.push(line),clock:()=>0,
  });
  assert.equal(result.ready,false);
  assert.equal(result.reason,"write_failed");
  assert.ok(calls.includes("ROLLBACK"));
  assert.equal(calls.at(-1),"end");
  assert.ok(!logs.join("\n").includes("secret"));
});
