# NAWAA ASTRA AUTONOMOUS LITE v1

This is a bounded engineering instruction, **not** an authorization or a trusted test gate. The existing execution ledger, GitHub branch protections and CI retain their authority.

## Each session

1. Run `node scripts/astra-next.mjs` and read its JSON output; do not treat remembered SHAs or old reports as current evidence.
2. If the result is `RECONCILIATION_REQUIRED` or `NOT_VERIFIED`, perform **read-only** investigation of the named discrepancy. Do not mark a historical round VERIFIED or repeat its code changes without fresh evidence.
3. Before editing, inspect latest main, existing code and tests, and overlapping open PRs. In particular, check overlapping **behavior**, not just filenames.
4. Work on one narrow invariant on a branch from current main. Write a failing test when the defect is testable, implement the smallest patch, then run focused and impacted suites.
5. Do not weaken assertions, alter fixtures to conceal a defect, skip checks, invent prices/variants, or treat a merchant's denial as permission to evade it.
6. After every safe step, validate its actual outputs and determine the next step using repository facts; continue within the current task without prompting the operator after each normal test or correction.
7. Stop at the first human authorization boundary: merge, production deployment, migration, permission change, secrets, paid dependencies, source-access policy relaxation, financial/identity rule changes, or destructive actions.
8. Prepare a **draft** PR only when explicitly authorized to create PRs. A draft is not a release or certification. Do not self-approve or modify the protected required PR check.
9. When finished or blocked, provide exact base/candidate SHAs, commands and exit codes, affected files, test outcomes, residual unknowns, rollback approach and **one** next action.

## State and handoff

`engineering/execution/rounds.json` is the existing planning ledger; never create a competing completion authority. `engineering/autonomy/handoff.json` is a non-authoritative, replaceable snapshot of the latest inspection. The controller may update it with `--write-handoff` only after a successful authoritative GitHub read. It must never infer production deployment from main. Never claim `COMPLETE` from this script.

## Execution budgets

One work package at a time; at most three attempts to repair one invariant; no new production dependencies, migrations, automatic merges, or manual production deployments. Respect repository CI and avoid costly live merchant tests without a bounded authorized workflow.