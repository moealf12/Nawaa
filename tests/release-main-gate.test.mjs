import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMainReleaseReadiness, REQUIRED_MAIN_JOBS } from '../scripts/verify-main-release-gate.mjs';

const SHA = 'e4293b2f437420896945b8fffab2b8c9fd4f9852';
const OLD_SHA = '0cec085a6ca6c48468f4d16af1e78cb27823a2f1';

const good = () => ({
  event: 'push',
  ref: 'refs/heads/main',
  sha: SHA,
  checkoutSha: SHA,
  needs: Object.fromEntries(REQUIRED_MAIN_JOBS.map((name) => [name, { result: 'success' }])),
});

test('main release readiness accepts every required success for the checked-out SHA', () => {
  assert.deepEqual(assessMainReleaseReadiness(good()), { allowed: true, sha: SHA });
});

test('main release readiness rejects missing required jobs (rather than a partial green)', () => {
  const sample = good();
  delete sample.needs['disposable-quote-lifecycle'];
  assert.deepEqual(assessMainReleaseReadiness(sample), {
    allowed: false,
    reason: 'required-jobs-not-successful',
    blockers: [{ job: 'disposable-quote-lifecycle', result: 'missing' }],
  });
});

for (const result of ['failure', 'cancelled', 'skipped', 'neutral', 'in_progress', 'timed_out']) {
  test(`main release readiness rejects ${result} on a mandatory job`, () => {
    const sample = good();
    sample.needs.test.result = result;
    const decision = assessMainReleaseReadiness(sample);
    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.blockers, [{ job: 'test', result }]);
  });
}

test('main release readiness rejects a stale successful checkout', () => {
  const sample = good();
  sample.checkoutSha = OLD_SHA;
  assert.equal(assessMainReleaseReadiness(sample).reason, 'incorrect-revision');
});

test('main release readiness rejects malformed, absent or mismatched revision', () => {
  for (const invalid of ['', 'main', undefined, OLD_SHA]) {
    const sample = good();
    sample.sha = invalid;
    assert.equal(assessMainReleaseReadiness(sample).allowed, false);
  }
});

test('main release readiness rejects PR and non-main push contexts', () => {
  for (const [event, ref] of [['pull_request', 'refs/heads/main'], ['push', 'refs/heads/feature/x']]) {
    const sample = good();
    sample.event = event;
    sample.ref = ref;
    assert.equal(assessMainReleaseReadiness(sample).reason, 'not-main-push');
  }
});

test('main release readiness rejects unknown needs envelopes', () => {
  for (const needs of [null, undefined, [], 'success']) {
    const sample = good();
    sample.needs = needs;
    assert.equal(assessMainReleaseReadiness(sample).reason, 'missing-job-results');
  }
});

test('main release readiness cannot be satisfied by unrelated green jobs', () => {
  const sample = good();
  sample.needs = { unrelated: { result: 'success' } };
  assert.equal(assessMainReleaseReadiness(sample).blockers.length, REQUIRED_MAIN_JOBS.length);
});
