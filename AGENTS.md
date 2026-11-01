# NAWAA ASTRA AUTONOMOUS LITE v1

This is a bounded engineering instruction, **not** an authorization or a trusted test gate. The existing execution ledger, GitHub branch protections and CI retain their authority.

## Each session

1. Run `node scripts/astra-next.mjs` and read its JSON output; do not treat remembered SHAs or old reports as current evidence.
2. If the result is `RECONCILIATION_REQUIRED` or `NOT_VERIFIED`, perform **read-only** investigation of the named discrepancy. Do not mark a historical round VERIFIED or repeat its code changes without fresh evidence.
3. Before editing, inspect latest main, existing code and tests, and overlapping open PRs. In particular, check overlapping **behavior**, not just filenames.
4. Work on one narrow invariant on a branch from current main. Write a failing test when the defect is testable, implement the smallest patch, then run focused and impacted suites.
5. Do not weaken assertions, alter fixtures to conceal a defect, skip checks, invent prices/variants, or treat a merchant's denial as permission to evade it.
6. After every safe step, validate its actual outputs and determine the next step using repository facts; continue within the current task without prompting the operator after each normal test or correction.
7. The operator has explicitly delegated ordinary merge and production release **decisions** to ASTRA. The agent may approve and execute an in-scope, reversible merge/release only using real granted GitHub/Render capabilities and after independently verified release gates below. It must not equate this instruction file with an API credential or a successful release gate. Separate operator approval remains required for migrations, destructive changes, secrets, permission/branch-protection changes, paid dependencies, source-access relaxation, and material changes to financial or identity certification rules.
8. The agent may open, review, mark ready, and merge an in-scope PR and let the existing Render deployment pipeline publish it. It must first verify exact PR head/base/main, clean mergeability, all required independent checks successful at that head, unaffected protected CI policy, no unresolved high-risk overlap, negative controls where relevant, and a rollback path. Do not self-approve, override protections, or treat a check edited by the candidate as independent evidence.
9. When finished or blocked, provide exact base/candidate SHAs, commands and exit codes, affected files, test outcomes, residual unknowns, rollback approach and **one** next action.

## State and handoff

`engineering/execution/rounds.json` is the existing planning ledger; never create a competing completion authority. `engineering/autonomy/handoff.json` is a non-authoritative, replaceable snapshot of the latest inspection. The controller may update it with `--write-handoff` only after a successful authoritative GitHub read. It must never infer production deployment from main. Never claim `COMPLETE` from this script.

## Execution budgets

One work package at a time; at most three attempts to repair one invariant; no new production dependencies or migrations without separate approval. Autonomous merges and deployments are permitted **only after** exact-revision independent CI, source/price/identity risk checks, rollback readiness, and authorized tool access; no forced merge or policy waiver. Prefer Render's existing GitHub auto-deploy; manual deploy only if necessary, actually permitted, and explicitly proven safe. Respect bounded live merchant tests.

## Reference materials and precedence

The operator supplied a historical engineering blueprint. Read only the sections relevant to the current task:

- `engineering/autonomy/references/NAWAA_ASTRA_OMEGA_v23_10_ARCHIVE.md` — **historical design reference**, not a live checklist or permission grant.
- `engineering/execution/rounds.json` — the existing 21-round/35-package state ledger; its claims must be reconciled with exact GitHub and deployment evidence.
- Current GitHub source, tests, workflows and open PRs — the execution baseline; do not use a SHA from the archived document as HEAD.

When these disagree, record `RECONCILIATION_REQUIRED` and investigate the smallest affected contract, **without repeating R01–R05 implementations or granting completed status from a commit title**. Use the blueprint's identity, price, source, temporal, resource-bound and independent-test invariants when relevant, but do not automatically enact its historical `FIRST ACTION`, merge, deploy, relax source rules or rewrite the roadmap.

**Delegated release autonomy:** the agent may decide and perform ordinary reversible merges and deployments as the operator's delegate when the independent release gates above succeed and actual GitHub/Render permissions allow them. In every deployment, it must prove the LIVE revision and run bounded customer acceptance; on failed acceptance, stop further rollout, attempt only an authorized/tested rollback or safe disablement, and report the exact result. A merged PR is not automatically a verified deployment. Unknown or contradictory evidence blocks release. This file itself does not activate a continuously running agent, grant credentials, or bypass branch protection.

## Autonomous merge and deployment decision gate

Before MERGE, require all of:
- exact current `main`, PR base and head SHA refreshed immediately before action; no unresolved overlap or base drift;
- scope reviewed and safe: no migration, destructive operation, policy/CI security weakening, secret access, paid services or source-policy relaxation;
- required independent GitHub checks complete with `success` on the exact PR head, and meaningful negative/target regression tests;
- no unresolved product identity, price, chronology, source-access, cache or completion-truth contradictions;
- a specific rollback or feature-disable plan, not merely a text claim; actual merge permission and branch protection respected.

Before DEPLOY: confirm intended merge SHA/artifact, authorized existing pipeline, and expected target environment. After deployment: verify LIVE /health exact revision and bounded real customer acceptance. If auto-deployment does not occur or the revision disagrees, record NOT_VERIFIED/BLOCKED rather than claim release success. Never suppress an adverse test for throughput.

The operator delegates decisions, not the power to rewrite safety rules; no agent-authored waiver for its own failures. Deliver an evidence-based release report after each completed operation.
