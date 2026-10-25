// v21.78: negative-control proof of actual security-critical ESLint coverage.
// The test uses the already-installed ESLint dev dependency; no external I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {ESLint} from 'eslint';

const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const lint=packageJson.scripts.lint;
test('v21.78 all current and future server trust modules are linted by prefix',()=>{
  for(const prefix of ['server/trusted-*.mjs','tests/trusted-*.test.mjs',
    'scripts/trusted-*.mjs','scripts/measure-search-latency.mjs'])
    assert.ok(lint.includes(prefix),'missing correctness coverage: '+prefix);
  // Audit the current actual source tree, not a hardcoded list of modules.
  const paths=[
    ...readdirSync(new URL('../server/',import.meta.url))
      .filter(n=>n.startsWith('trusted-')&&n.endsWith('.mjs')),
    ...readdirSync(new URL('../tests/',import.meta.url))
      .filter(n=>n.startsWith('trusted-')&&n.endsWith('.test.mjs')),
    ...readdirSync(new URL('../scripts/',import.meta.url))
      .filter(n=>n.startsWith('trusted-')&&n.endsWith('.mjs'))
  ];
  assert.ok(paths.length>=20,'security-critical path discovery incomplete');
});
test('v21.78 independent ESLint negative control detects missing source authority',async()=>{
  const checker=new ESLint({errorOnUnmatchedPattern:false});
  const filename='server/trusted-negative-control.mjs';
  const [negative]=await checker.lintText('const x = missingSourceEvidence;',{filePath:filename});
  assert.ok(negative.messages.some(m=>m.ruleId==='no-undef'&&
    m.severity===2&&m.message.includes('missingSourceEvidence')),
    'the actual ESLint configuration must reject an unbound authority');
  const [positive]=await checker.lintText(
    'const x = Buffer.from("safe"); export {x};',{filePath:filename});
  assert.equal(positive.errorCount,0,'correct built-in Node globals must remain accepted');
});
