import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Search Core pull requests test the merge ref rather than forcing the branch head',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/search-core-tests.yml',import.meta.url),'utf8');
 assert.match(workflow,/^  pull_request:/m);
 const checkout=workflow.match(/^\s*- uses: actions\/checkout@v4(?:\r?\n(?!\s*- ).*)*/m)?.[0];
 assert.ok(checkout,'Search Core must check out repository content');
 assert.doesNotMatch(checkout,/\bref\s*:/,'ref override bypasses the GitHub-generated PR merge commit');
 // github.head_ref is valid for a conditional smoke test; it must not override checkout.ref.
});
