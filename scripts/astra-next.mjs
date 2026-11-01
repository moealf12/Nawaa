#!/usr/bin/env node
// NAWAA ASTRA Lite: read-only current-point selector. No new runtime packages.
import {readFile, mkdir, rename, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'moealf12/Nawaa';
const SHA = /^[a-f0-9]{40}$/;
const HEADERS = {'Accept': 'application/vnd.github+json', 'User-Agent': 'NAWAA-ASTRA-Lite/1'};
const VALID_STATES = new Set(['VERIFIED', 'IN_PROGRESS', 'PLANNED', 'BLOCKED']);

function git(...args) {
  try { return execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', timeout: 4500, stdio: ['ignore','pipe','ignore']}).trim(); }
  catch { return null; }
}

export function determineNext(ledger, snapshot) {
  const unknowns = [];
  const mainSha = snapshot?.mainSha;
  if (!SHA.test(mainSha ?? '')) unknowns.push('CURRENT_MAIN_SHA_UNKNOWN');
  if (!snapshot?.commitMessage || typeof snapshot.commitMessage !== 'string') unknowns.push('MAIN_COMMIT_MESSAGE_UNKNOWN');
  if (!Array.isArray(snapshot?.openPrs)) unknowns.push('OPEN_PR_INVENTORY_UNKNOWN');
  if (!ledger || !Array.isArray(ledger.rounds) || ledger.rounds.length !== 21) unknowns.push('LEDGER_INVALID_OR_MISSING');
  if (unknowns.length) return {status: 'NOT_VERIFIED', currentRound: null, nextAction: 'RETRIEVE_CURRENT_POINT', unknowns};
  if (ledger.rounds.some((r, i) => r.id !== `R${String(i + 1).padStart(2, '0')}` || !VALID_STATES.has(r.status))) {
    return {status: 'NOT_VERIFIED', currentRound: null, nextAction: 'VALIDATE_LEDGER', unknowns: ['LEDGER_STATUS_OR_ORDER_INVALID']};
  }
  const active = ledger.rounds.filter(r => r.status === 'IN_PROGRESS');
  if (active.length > 1) return {status: 'RECONCILIATION_REQUIRED', currentRound: active[0].id, nextAction: 'RECONCILE_LEDGER', unknowns: ['MULTIPLE_ACTIVE_ROUNDS']};
  const first = ledger.rounds.findIndex(r => r.status !== 'VERIFIED');
  if (first === -1) return {status: 'NOT_VERIFIED', currentRound: null, nextAction: 'REVIEW_FINAL_ACCEPTANCE', unknowns: ['ALL_ROUNDS_MARKED_VERIFIED_NOT_INDEPENDENTLY_VALIDATED']};
  const target = ledger.rounds[first];
  if (ledger.rounds.slice(first + 1).some(r => r.status === 'VERIFIED' || r.status === 'IN_PROGRESS')) {
    return {status: 'RECONCILIATION_REQUIRED', currentRound: target.id, nextAction: 'RECONCILE_LEDGER', unknowns: ['ROUND_SEQUENCE_CONFLICT']};
  }
  // A commit subject mentioning a later round is an overlap clue, NOT proof of certification.
  const referencedRounds = [...snapshot.commitMessage.matchAll(/\bR(\d{2})\b/gi)]
    .map(m => `R${m[1]}`);
  const mismatch = referencedRounds.find(id => {
    const idx = ledger.rounds.findIndex(r => r.id === id);
    return idx > first && ledger.rounds[idx].status === 'PLANNED';
  });
  if (mismatch) return {
    status: 'RECONCILIATION_REQUIRED', currentRound: target.id, nextAction: 'RECONCILE_LEDGER',
    unknowns: [`HEAD_MENTIONS_${mismatch}_WHILE_LEDGER_PLANNED`, 'COMMIT_MESSAGE_IS_NOT_ROUND_CERTIFICATION']
  };
  if (target.status === 'BLOCKED') return {status: 'BLOCKED', currentRound: target.id, nextAction: 'READ_ROUND_BLOCKERS', unknowns: []};
  // Old open PRs are not all blockers, but overlap is not proven absent by listing titles.
  return {
    status: 'INVESTIGATE', currentRound: target.id,
    nextAction: target.status === 'IN_PROGRESS' ? 'INSPECT_ACTIVE_ROUND_EVIDENCE_AND_OVERLAP' : 'INSPECT_TARGET_IMPLEMENTATION_AND_OVERLAP',
    unknowns: ['BEHAVIORAL_PR_OVERLAP_NOT_YET_ASSESSED', 'LIVE_DEPLOYMENT_SHA_NOT_CHECKED']
  };
}

async function github(path, {timeoutMs = 8000} = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = {...HEADERS, ...(token ? {'Authorization': `Bearer ${token}`} : {})};
  const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {headers, signal});
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
  return response.json();
}

export async function githubSnapshot() {
  // Fixed repository endpoints: no user-supplied outbound URL or merchant requests.
  const commit = await github('commits/main');
  const openPrs = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await github(`pulls?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GITHUB_PR_RESPONSE_INVALID');
    openPrs.push(...batch.map(p => ({number: p.number, title: p.title, headSha: p.head?.sha, baseSha: p.base?.sha})));
    if (batch.length < 100) break;
    if (page === 5) throw new Error('GITHUB_PR_INVENTORY_TRUNCATED');
  }
  return {mainSha: commit.sha, commitMessage: commit.commit?.message, openPrs};
}

async function writeHandoff(handoff) {
  const output = resolve(ROOT, 'engineering/autonomy/handoff.json');
  await mkdir(dirname(output), {recursive: true});
  const temp = `${output}.tmp-${process.pid}`;
  await writeFile(temp, JSON.stringify(handoff, null, 2) + '\n', {flag: 'wx'});
  await rename(temp, output);
}

export async function main({write = false} = {}) {
  const observedAt = new Date().toISOString();
  let snapshot = null;
  let retrievalError = null;
  try { snapshot = await githubSnapshot(); }
  catch (error) { retrievalError = error instanceof Error ? error.message : String(error); }
  let ledger = null;
  try { ledger = JSON.parse(await readFile(resolve(ROOT, 'engineering/execution/rounds.json'), 'utf8')); }
  catch { /* absence is classified, not defaulted to a favorable state */ }
  const decision = determineNext(ledger, snapshot);
  if (retrievalError) decision.unknowns.push(`GITHUB_RETRIEVAL_FAILED:${retrievalError}`);
  const localHeadSha = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain');
  const handoff = {
    schemaVersion: 'nawaa.autonomy.handoff.v1', observedAt, repository: REPO,
    mainSha: snapshot?.mainSha ?? null, localHeadSha: SHA.test(localHeadSha ?? '') ? localHeadSha : null,
    currentRound: decision.currentRound, status: decision.status,
    nextAction: decision.nextAction, openPrCount: snapshot?.openPrs.length ?? null,
    unknowns: [...decision.unknowns], deploymentSha: null
  };
  if (dirty === null) handoff.unknowns.push('LOCAL_WORKTREE_UNKNOWN');
  else if (dirty !== '') handoff.unknowns.push('LOCAL_WORKTREE_DIRTY');
  if (handoff.localHeadSha === null) handoff.unknowns.push('LOCAL_HEAD_UNKNOWN');
  // Never select a write operation based on incomplete or mismatched local state.
  if (handoff.mainSha && handoff.localHeadSha && handoff.mainSha !== handoff.localHeadSha) {
    handoff.unknowns.push('LOCAL_HEAD_DIFFERS_FROM_MAIN_CHECK_BRANCH_BASE');
  }
  if (write && snapshot?.mainSha && Array.isArray(snapshot.openPrs)) await writeHandoff(handoff);
  process.stdout.write(JSON.stringify(handoff, null, 2) + '\n');
  return handoff.status === 'NOT_VERIFIED' ? 2 : handoff.status === 'RECONCILIATION_REQUIRED' ? 3 : handoff.status === 'BLOCKED' ? 4 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const valid = process.argv.slice(2).every(x => x === '--write-handoff') && process.argv.slice(2).length <= 1;
  if (!valid) {console.error('Usage: node scripts/astra-next.mjs [--write-handoff]'); process.exitCode = 64;}
  else main({write: process.argv.includes('--write-handoff')}).then(x => {process.exitCode = x;}).catch(e => {console.error(String(e)); process.exitCode = 1;});
}
