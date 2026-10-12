# NAWAA V2 — Production Migration Contract v5.0 (DESIGN ONLY)

**Status:** specification, NOT an authorization, migration execution script, or production credential. No production writes or deployment permitted. The current `assertEphemeralDatabase` restriction MUST remain intact.

## Dependencies and release gates

1. Freeze a reviewed source SHA and inspect real production schema/extension versions, role owners, table counts, sizes, indexes, locks and connection budget using a read-only role.
2. Verify provider free-tier quotas, egress, backup export, suspended-project behavior, restore capability and provider-specific TLS identity; never assume free PITR or SLA.
3. Take a consistent export/snapshot and restore to a separately approved isolated environment; validate schema, row counts, representative hashes and referential integrity; record recovery duration and RPO/RTO. If a viable restorable copy is unavailable, STOP.
4. Approve DB target identity with TLS verification, pinned expected host/database where supported, and secret-managed credentials. CI URL and session attestation cannot authorize production.
5. Approve migration-only DDL role, application DML role, worker role and read-only parity role. Lock down `public` schema CREATE, ownership, search_path, default privileges and sequence grants. Remove migration credentials after execution.
6. Run additive migration in bounded transactions with lock_timeout and statement_timeout. Never call `initV2`, `initShadowOutbox`, or `initPersistence` as production migration drivers.
7. Enable opt-in durable receipt/outbox only after schema compatibility and transactional legacy+intent atomicity are proved. Never dual-write independently across separate commits.
8. Backfill with stable source identity, bounded batches, retry-safe receipts, unresolved quarantine, and immutable observation history; maintain progression marks atomically with writes.
9. Perform read-only parity on keyed source/listing/variant/condition, currency, price and observed_at. Hold customer reads on legacy until independent canary approval.
10. Roll back by disabling producer/worker/read flags and draining in-flight transactions; do not delete observations/receipts/outbox during a routine rollback.

## Versioned ledger contract (proposal, not deployed)

`nawaa_schema_migrations(version text PRIMARY KEY, checksum_sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), applied_by text NOT NULL)`

Version format `v2_0001`, `v2_0002`, etc. The migration runner MUST use an advisory migration lock, verify an expected source-schema fingerprint, reject a version with a different checksum, execute DDL plus ledger insert in one transaction where PostgreSQL supports transactional DDL, and emit a signed-off read-only verification report. No app-runtime DDL privileges.

| Version | Additive scope | Rehearsal gate | Rollback |
|---|---|---|---|
| v2_0001 | Ledger and dedicated V2 offer/observation schema, constraints and immutable triggers | Fresh and existing-schema upgrade | Leave new tables unused; no loss of legacy |
| v2_0002 | Receipt table with unique ingestion_id and exact payload digest; immutable/explicit conflict semantics | Concurrent duplicates + ambiguous commit | Disable V2 writes |
| v2_0003 | Durable Outbox, attempts, bounded ready/lease indexes and claim-token fencing | Lease contention, pool max=1, crash and retry exhaustion | Stop worker, preserve attempts |
| v2_0004 | Backfill progress and unresolved quarantine | Restart, stale snapshot and variant collision | Stop at marker; never rewind by deletion |

Each migration must have pre/postcondition SQL, schema diff, bounded lock budget, checksum, forward-only recovery instructions, provider-safe backup/restore evidence and explicit owner approval. Privileges must be granted per table, sequence and function rather than broad ALL ON SCHEMA.

## Audit invariants

- Stable receipt `ingestion_id` must map to exactly one immutable payload identity; conflicting replay fails closed.
- Durable Outbox intent must commit atomically with the legacy observation/current row.
- An Outbox claim can be acknowledged only by its current claim_token owner; expired claims cannot write after a newer owner without lock/fencing protection.
- Historical observations append once; delayed older observations cannot overwrite newer canonical prices.
- Source-specific identity cannot silently merge unspecified variants; unknown variants go to quarantine.
- Unauthenticated or wrong-target connections must not cause V2 DDL, receipt, outbox or legacy writes.
- Production credentials must never appear in workflows, logs, URLs in reports, or client bundles.

## Read-only parity gate

Sample by source, time bucket, market, variant and price volatility rather than random sample alone. Report numerator/denominator for: accepted identity matches, currency equality, canonical price equality at comparable timestamps, freshness lag, duplicate receipts, missing Outbox intents, pending/processing/dead age, unresolved variant rate. **Hard stop** on any unexplained high-confidence price/currency/identity mismatch. No success claim with zero denominator.

## Rollback & stress tests

Verify transaction interruption before/after COMMIT, connection loss, deadlock, serialization retries, exhaustion, restart with pending claims, duplicate concurrent writers, max-connection pressure, slow/oversized JSON, failed migrations at each version and disk quota near exhaustion. Define RPO/RTO from restore rehearsal (not guesses). Never attempt destructive reverse migration automatically.

## Iteration controls

Every engineering iteration must (a) read the previous checkpoint, (b) independently discover actual HEAD/base/merge SHA, (c) classify new risks by risk and evidence, (d) address only reproduced P0/P1 with regression tests, (e) run both required tests on one final synthetic merge SHA, (f) update this risk inventory and next checkpoint. Every HEAD mutation invalidates prior final-CI evidence. No speculative code rewrite to inflate completion percentage.

**Owner approvals remain separate:** merge, branch protection, provisioning, schema migration, shadow activation, canary, production reads. Passing CI authorizes none of these.
