import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function cli(args) {return spawnSync(process.execPath,["scripts/audit-source.mjs",...args],{encoding:"utf8",timeout:10000});}
test("CLI lists the real runtime catalog without credentials or network access",()=>{
  const r=cli(["--list"]);assert.equal(r.status,0,r.stderr);
  const d=JSON.parse(r.stdout);assert.equal(d.schemaVersion,"nawaa.source-catalog.v1");
  assert.ok(d.sources.some(x=>x.id==="extra"));assert.ok(!r.stdout.includes("CLIENT_SECRET"));
});
test("CLI rejects unknown sources instead of reporting a successful empty audit",()=>{
  const r=cli(["--source","unknown","--query","iphone"]);assert.equal(r.status,2);assert.match(r.stderr,/Unknown source/);
});
test("CLI records an unconnected source and exits with a skipped status",()=>{
  const r=cli(["--source","currys","--query","laptop"]);assert.equal(r.status,3,r.stderr);
  const d=JSON.parse(r.stdout);assert.equal(d.status,"UNCONNECTED");assert.equal(d.verifiedSource,false);assert.equal(typeof d.revision,"string");
});
test("CLI search timeout has complete attribution and unknown counts",()=>{
  const dir=mkdtempSync(join(tmpdir(),"nawaa-cli-"));
  try {
    const mock=join(dir,"hang.mjs");writeFileSync(mock,"globalThis.fetch=()=>new Promise(()=>{});\n");
    const r=spawnSync(process.execPath,["--import",pathToFileURL(mock).href,"scripts/audit-source.mjs","--source","extra","--query","iphone","--timeout-ms","100"],{encoding:"utf8",timeout:10000});
    assert.equal(r.status,1,r.stderr);const d=JSON.parse(r.stdout);
    assert.equal(d.status,"TIMEOUT");assert.equal(d.source.adapter,"extra-unbxd");
    assert.deepEqual(d.counts,{raw:null,accepted:null,rejected:null,duplicates:null});
    assert.deepEqual(d.samples,[]);assert.deepEqual(d.rejections,[]);assert.deepEqual(d.errorCodes,["TIMEOUT"]);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
