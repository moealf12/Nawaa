import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('PostgreSQL workflow covers all transactional persistence modules and their tests',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/persistence-v2-evidence.yml',import.meta.url),'utf8');
 const pr=workflow.indexOf('  pull_request:');
 const dispatch=workflow.indexOf('  workflow_dispatch:');
 assert.ok(pr>=0 && dispatch>pr,'persistence workflow must register a pull_request trigger');
 const trigger=workflow.slice(pr,dispatch);
 const critical=[
  'server/persistence.mjs',
  'server/persistence-v2.mjs',
  'server/persistence-v2-outbox.mjs',
  'server/persistence-v2-backfill.mjs',
  'server/persistence-v2-shadow.mjs',
  'server/offer-identity-v2.mjs',
  'tests/ephemeral/**',
  'tests/offer-identity-v2.test.mjs',
  'tests/persistence-v2-shadow.test.mjs',
  'tests/persistence-ci-coverage.test.mjs',
  'package.json',
  'package-lock.json'
 ];
 for(const path of critical){
  assert.ok(trigger.includes("- '"+path+"'"),'PostgreSQL evidence must trigger on '+path);
 }
});
