import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const REQUIRED_MAIN_JOBS = Object.freeze([
  'test',
  'disposable-postgres-provenance',
  'disposable-meilisearch-restart',
  'disposable-omega-consistency',
  'disposable-quote-lifecycle',
]);

const COMMIT_SHA = /^[a-f0-9]{40}$/;

/**
 * Fail-closed decision for the five jobs belonging to this exact push workflow run.
 * GitHub Actions provides "needs" scoped to this run, not historical check results.
 * A successful job cannot substitute for a missing, cancelled, or skipped job.
 */
export function assessMainReleaseReadiness({ event, ref, sha, checkoutSha, needs }) {
  if (event !== 'push' || ref !== 'refs/heads/main') {
    return { allowed: false, reason: 'not-main-push' };
  }

  if (!COMMIT_SHA.test(sha ?? '') || checkoutSha !== sha) {
    return { allowed: false, reason: 'incorrect-revision' };
  }

  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
    return { allowed: false, reason: 'missing-job-results' };
  }

  const blockers = REQUIRED_MAIN_JOBS
    .filter((job) => needs[job]?.result !== 'success')
    .map((job) => ({ job, result: needs[job]?.result ?? 'missing' }));

  return blockers.length
    ? { allowed: false, reason: 'required-jobs-not-successful', blockers }
    : { allowed: true, sha };
}

function main() {
  const needs = JSON.parse(process.env.NAWAA_RELEASE_NEEDS_JSON ?? 'null');
  const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  const decision = assessMainReleaseReadiness({
    event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
    checkoutSha,
    needs,
  });

  if (!decision.allowed) {
    console.error('RELEASE_BLOCKED:', JSON.stringify(decision));
    process.exitCode = 1;
    return;
  }

  console.log('MAIN_RELEASE_CI_READY:', decision.sha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error('RELEASE_BLOCKED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
