import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = name => readFileSync(
  new URL('../.github/workflows/'+name,import.meta.url),'utf8');

function assertUnfilteredPullRequestTrigger(source,name) {
  // A required check must be reported for documentation-only and workflow-only PRs too.
  // GitHub leaves path-filtered required checks pending on non-matching PRs.
  const lines=source.split(/\r?\n/);
  const start=lines.findIndex(line=>line==='  pull_request:');
  assert.ok(start>=0,name+': missing pull_request event');
  const next=lines.slice(start+1).find(line=>line.trim().length);
  assert.ok(next && !/^    /.test(next),name+': required PR workflow must not have paths/branches filters');
  assert.doesNotMatch(source,/^  pull_request:\s*(?:\r?\n)    (?:paths|paths-ignore|branches|branches-ignore):/m,
    name+': required status cannot be conditionally absent');
}

test('Search Core test check is emitted on every pull request',()=>{
  const source=workflow('search-core-tests.yml');
  assertUnfilteredPullRequestTrigger(source,'Search Core');
  assert.match(source,/^  test:/m,'expected stable required context test');
  assert.match(source,/name: Verify PR merge checkout provenance/);
});

test('PostgreSQL ephemeral-postgres check is emitted on every pull request',()=>{
  const source=workflow('persistence-v2-evidence.yml');
  assertUnfilteredPullRequestTrigger(source,'PostgreSQL');
  assert.match(source,/^  ephemeral-postgres:/m,'expected stable required context ephemeral-postgres');
  assert.match(source,/name: Verify PR merge checkout provenance/);
  assert.match(source,/for suite in tests\/ephemeral\/\*\.test\.mjs/,'all ephemeral suites must execute');
});

test('required GitHub checks retain unique stable job identifiers',()=>{
  const search=workflow('search-core-tests.yml');
  const pg=workflow('persistence-v2-evidence.yml');
  assert.doesNotMatch(search,/^  ephemeral-postgres:/m);
  assert.doesNotMatch(pg,/^  test:/m);
});
