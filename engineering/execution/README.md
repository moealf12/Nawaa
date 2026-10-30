# NAWAA — evidence-locked 21-round execution ledger

This directory represents planned engineering work E00-E17 and S00-S16, each
assigned to exactly one round (R01-R21). The final round certifies the full
system and owns no extra implementation package.

## Rules

- GitHub PR head, tests, checks, and actual Render LIVE revision are the source
  of truth. Conversation summaries and historical blueprint SHAs are not.
- Run node scripts/verify-execution-ledger.mjs on every PR. The required
  nawaa-required-pr-check job is the stable protection entry point.
- Every active round records its exact base SHA. Advance sequentially;
  never overlap incomplete rounds under this ledger. Each change has its
  own narrowly scoped PR, change impact and negative-control tests.
- A VERIFIED round requires externally checked PR, CI and regression URLs,
  tested/merged/live SHAs, deployment ID, negative control and customer
  acceptance. Valid URL syntax alone is NOT external verification.
- Use BLOCKED with a specific reason if an invariant, gate, scope, dependency,
  source permission, production confirmation, or cost constraint fails.
- No publication of unverified prices, false variant merges, stale observations,
  or incomplete search coverage as complete. Merchant failure never erases
  other merchants' valid evidence.
- Keep the project zero-paid. Never confuse a registry candidate with a
  source that was attempted, verified, or displayed.

## R01 scope (currently IN_PROGRESS, NOT closed)

This PR is the first **governance slice**, creating durable ownership and
negative-control ledger tests in the protected required PR workflow.

Remaining R01 work before marking VERIFIED:
1. Pin labeled multi-category corpus and source-stage acceptance fixtures.
2. Require exact-PR-SHA relevant PG/Meilisearch/Python integrations through
   a reliable aggregate CI gate, with real failure-injection controls.
3. Verify PR, branch rule, production deployment and frontend/backend health.
4. Save checked URLs and SHA-bound evidence. Do NOT backfill fabricated proof.

The ledger validator checks structure and required proof fields. It cannot
know whether remote evidence links are truthful; a release agent must fetch
and verify them independently. A passed npm suite is not a universal proof.
