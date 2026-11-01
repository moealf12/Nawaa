import test from 'node:test';
import assert from 'node:assert/strict';
import {determineNext} from '../scripts/astra-next.mjs';

const SHA = 'a'.repeat(40);
const fixture = () => ({rounds: Array.from({length: 21}, (_, i) => ({
  id: `R${String(i + 1).padStart(2, '0')}`, status: i < 3 ? 'VERIFIED' : i === 3 ? 'IN_PROGRESS' : 'PLANNED'
}))});
const current = (message = 'docs: routine update') => ({mainSha: SHA, commitMessage: message, openPrs: []});

test('fail-closed when GitHub main and PR inventory are unknown', () => {
  const x = determineNext(fixture(), null);
  assert.equal(x.status, 'NOT_VERIFIED');
  assert.equal(x.nextAction, 'RETRIEVE_CURRENT_POINT');
});
test('never treat later merged round mention as proof of completion', () => {
  const x = determineNext(fixture(), current('R05: bounded HTTP 403 cooldown'));
  assert.equal(x.status, 'RECONCILIATION_REQUIRED');
  assert.equal(x.currentRound, 'R04');
  assert.ok(x.unknowns.includes('HEAD_MENTIONS_R05_WHILE_LEDGER_PLANNED'));
});
test('ordinary current main resumes active round, not a later planned round', () => {
  const x = determineNext(fixture(), current());
  assert.equal(x.status, 'INVESTIGATE');
  assert.equal(x.currentRound, 'R04');
  assert.equal(x.nextAction, 'INSPECT_ACTIVE_ROUND_EVIDENCE_AND_OVERLAP');
});
test('verified R04 and R05 make R06 the next investigation, not auto-certified', () => {
  const f = fixture();
  f.rounds[3].status = 'VERIFIED';
  f.rounds[4].status = 'VERIFIED';
  const x = determineNext(f, current('R05: bounded HTTP 403 cooldown'));
  assert.equal(x.status, 'INVESTIGATE');
  assert.equal(x.currentRound, 'R06');
  assert.ok(x.unknowns.includes('BEHAVIORAL_PR_OVERLAP_NOT_YET_ASSESSED'));
});
test('reject invalid ledger ordering and unknown status', () => {
  const f = fixture();
  f.rounds[4].status = 'GREAT';
  assert.equal(determineNext(f, current()).status, 'NOT_VERIFIED');
});
test('do not select a blocked round', () => {
  const f = fixture();
  f.rounds[3].status = 'BLOCKED';
  const x = determineNext(f, current());
  assert.equal(x.status, 'BLOCKED');
  assert.equal(x.nextAction, 'READ_ROUND_BLOCKERS');
});
test('do not infer certification from all VERIFIED', () => {
  const f = fixture();
  f.rounds.forEach(r => {r.status = 'VERIFIED';});
  assert.equal(determineNext(f, current()).status, 'NOT_VERIFIED');
});
test('reject inconsistent later active round', () => {
  const f = fixture();
  f.rounds[4].status = 'IN_PROGRESS';
  assert.equal(determineNext(f, current()).status, 'RECONCILIATION_REQUIRED');
});
