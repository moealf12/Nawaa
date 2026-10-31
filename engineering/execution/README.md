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

## Round status

- R01 VERIFIED — see `R01-evidence.md`
- R02 VERIFIED — see `R02-evidence.md`
- R03–R21 PLANNED

This README is informational. `rounds.json`, exact GitHub checks and
actual Render LIVE commit remain authoritative. Do not start another
round until the certification PR itself is deployed and verified.
