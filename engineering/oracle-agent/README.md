# Oracle experiment governance gate — NAWAA

**Status: isolated experiment, no merge or production deployment.**

Current isolated branch: `experiment/oracle-noon-sa-governance-20261106`, based on exact main commit
`698a8bdb1d912a04598d655b93b64dc54ac841ca`. Do not amend pre-existing PRs #302, #303, #326 or the durable
21-round execution plan in `engineering/execution/rounds.json`.

## Separation of concerns

- `rounds.json` remains the authoritative business engineering plan; this folder is an **execution receipt**, not a replacement plan or an autonomous AI brain.
- `manifest.json` freezes scope, source, baseline, allowed files, cost ceiling, request budget, and forbidden actions.
- `events.jsonl` is an ordered SHA-256 linked audit journal. It is tamper-**evident**, not tamper-proof; Git commit/PR history and required CI checks are the external audit anchors.
- `scripts/verify-oracle-handshake.mjs` refuses missing, reordered, altered or ambiguous receipts. Run it before each handoff.
- `scripts/noon-oracle-probe.py` makes a bounded public request from the actual Oracle host. It cannot bypass robot/access restrictions, use proxies or submit customer-facing offers.

## Required handshake

1. **RECONSTRUCT:** re-read current `main` SHA, open PRs, existing workstream leases, Oracle server status and production separation. Never infer these from conversational memory.
2. **LOCK / PRECONDITION:** branch-scoped optimistic write using exact expected commit SHA. An actual cross-branch distributed lease MUST use an atomic remote compare-and-set; **no such lease is installed yet**. Do not claim ownership merely because the branch exists.
3. **INTENT:** compare task ID, base SHA, scope hash, allowed paths, zero-USD budget and no-merge/no-deploy flags; stop on ambiguity or conflicts.
4. **PREPARE:** run deterministic tests, validate headers and first-party scope, and allow at most the manifest's HTTP request budget.
5. **OBSERVE:** record timestamped Oracle Gateway job ID and raw-status metadata, including errors, response hash if observed, and evidence classification. No fabricated prices, completed coverage or PDP proof.
6. **VERIFY:** exact-head CI, negative controls, source correctness and provenance. A successful diagnostic run is **not** an upstream success.
7. **HANDOFF:** produce explicit GO / NO-GO for the *next isolated test*, never for production merge. Human review required before any production change.

**Safety stops:** upstream HTTP 401/403/429, robots unknown/disallowed, timeout, conflicting branch, stale main SHA, ambiguous currency/SKU/offer provenance, exceeded budget, missing evidence, or failed CI.

## Fail-closed rules

- The ledger verifier is a structural gate. It **cannot** independently prove that upstream pages were retrieved, that a recorded job really ran, or that Oracle billing is zero.
- A GitHub branch is not an autonomous process. No scheduler, paid model API, unattended agent, merge automation, public network port, or secrets have been enabled.
- Caller must independently compare **live** `main` SHA with the frozen `baseMainSha` before any later code mutation. Provide `--current-main-sha` to the verifier.
- Source search HTML/card prices are diagnostic candidates until independently linked to source-owned SKU, exact offer, currency and PDP parity.
- Noon Saudi test results remain unavailable to shoppers. The local probe must terminate on robots uncertainty or first access-denial response.
- Only add data to this ledger from a *real tool-observed execution* with job reference; never write a success state based on an expectation.
