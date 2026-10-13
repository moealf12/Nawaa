import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

for (const name of ['search-core-tests.yml','persistence-v2-evidence.yml']) {
  test(name+' enforces PR synthetic merge checkout provenance',()=>{
    const workflow=readFileSync(new URL('../.github/workflows/'+name,import.meta.url),'utf8');
    assert.match(workflow,/^\s+pull_request:/m);
    assert.match(workflow,/name: Verify PR merge checkout provenance/);
    assert.match(workflow,/expected_pr_merge_ref/);
    assert.match(workflow,/checkout_not_at_merge_sha/);
    const checkout=workflow.match(/- uses: actions\/checkout@v4(?:\r?\n(?!\s*- ).*)*/)?.[0];
    assert.ok(checkout,'actions/checkout must be present');
    assert.doesNotMatch(checkout,/\bref\s*:/,'checkout must not override the default PR merge SHA');
  });
}
