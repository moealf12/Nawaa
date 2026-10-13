# NAWAA V2 — reversible zero-cost production transition design (v4.6)

**Design only — no migration, new infrastructure, merge, deployment or feature activation authorized.**
The current `assertEphemeralDatabase` permits only the CI local PostgreSQL URL.
`initV2`, Outbox and Backfill MUST NOT be used with a production connection as written.
Removing this guard or replacing it with `true` is prohibited.

## Preconditions / go-no-go ownership

- Obtain explicit owner permission separately for repository merge, environment provisioning,
  any production DB migration, activating shadow ingestion, and customer-facing reads.
- Approve a provider after verifying current free-tier quotas, retention, terms and
  backups. Do not assume that a free-tier database offers PITR, guaranteed durability,
  no suspension, free egress, or indefinite retention.
- Verify full current `main`, the actual deployed application version and schema,
  source ownership, existing `na waa_offers` / `offer_observations` volume and cardinality
  **before** preparing a migration. No production reads are performed by this design.
- Review connection budget across Render/worker instances; prefer bounded 1–4 connection
  pools initially, one durable worker, explicit query/lock/statement timeouts,
  measured IO/storage quotas, low-cardinality telemetry and throttled backfill.
- Separate privileges: an explicitly approved migration role may execute DDL;
  application and read-only verification roles MUST NOT execute DDL.

## Staged, reversible rollout

| Stage | Operation | Evidence / invariant | Rollback |
| --- | --- | --- | --- |
| 0: CI only | Current ephemeral PostgreSQL and synthetic PR merge CI | Identity, receipts, concurrency, rollback, Backfill and Outbox tests green | Keep all production V2 switches off |
| 1: Inventory | Read-only DB schema, row counts, constraints and storage | No unreviewed mutation; capacity/cost projections | Exit with no changes |
| 2: Backup rehearsal | Verify restorable snapshot/export into an isolated free sandbox | Restore checksum, keys and timestamps match source | Discard isolated sandbox |
| 3: Migration | Explicit approved versioned additive DDL (transactional where safe) | Schema diff and recorded migration ID; preserve legacy tables | Stop rollout; reversible DDL only if proved safe, otherwise leave unused new tables |
| 4: Shadow | One bounded worker; immutable V2 observations, durable receipt/outbox | 0 unexpected identity merges, 0 duplicates, no rising retry/dead-letter tail, no legacy-write impact | Stop worker and disable shadow; preserve audit rows |
| 5: Backfill | Batches of <=25; progress markers and explicit unresolved quarantine | No old observation promotion to fresh price; source/variant evidence retained | Stop at checkpoint; rerun idempotently without deleting history |
| 6: Shadow comparison | Read-only join/diff on sampled legacy versus V2 canonical offers | Variant/currency/price/time discrepancy report; zero unexplained critical mismatches | Keep customer reads on legacy |
| 7: Canary | Separately authorized low-volume opt-in reads, no customer search rewrite without approval | P95/error rate, correctness and freshness within approved SLO | Feature flag off, return to legacy reads |
| 8: Expansion | Widen only after evidence and explicit approval | Verified backups, timeouts, graceful degradation, budget intact | Last-known-good release and disable V2 feature flag |

## Safety and verification contracts

1. **Immutable history:** every accepted observation is appended once per stable
   `ingestion_id`; never update/delete an historical record during recovery.
2. **Identity:** `sourceId + listing + variant + condition` are part of stable offer identity.
   Ambiguous variants remain unresolved and are NOT assigned a guessed SKU.
3. **Currency and time:** capture original market, currency and timestamp.
   A later-arriving older observation may enter immutable history but never replace
   a newer canonical snapshot; do not present an unverified price as fully delivered.
4. **Outbox:** the legacy observation, canonical legacy row and durable event intent
   commit atomically. Claim-token fencing and leased acknowledgements are mandatory;
   expired max-attempt events must create one terminal attempt audit.
5. **Retry after ambiguous commit:** use stable receipt/event ID and compare exact
   accepted canonical/legacy hashes. A conflicting replay must fail closed.
6. **Migration:** use a version table; application process MUST NOT attempt ad hoc
   `CREATE/ALTER/DROP` on production requests. Current V2 helper initializers are
   ephemeral-only and are **not** a production migration system.
7. **Credential hygiene:** no credentials in logs or URLs; private storage for DB backups,
   rotated secrets; permissions for DDL separate from ongoing writes; secrets not sent to browser.
8. **Security:** test malicious/malformed nested payloads and URL integrity; bound input
   size, batch size and JSON depth before production enabling.
9. **Monitoring:** count accepted/rejected observations, retries, dead letters, stale claims,
   lag, storage used, DB pool waits, query errors, source errors, 95th percentile writes
   and identity conflict rate. Retain only minimal low-cost aggregate metrics.

## Rollback decision and anti-data-loss controls

- Trigger rollback at any unexplained identity collision, wrong price/currency, duplicate
  immutable observation, missing durable intent, broken lease fencing, or quota exhaustion.
- Default rollback is **disable** shadow worker/read flag; legacy search and legacy
  persistence remain unchanged. Do not silently delete new V2 history.
- Stop all writers before any restore; restore only against a verified isolated target
  first. Compare row counts/keys/checksums before any controlled production restoration.
- If a DB provider has no free, supported backups/PITR, do not label rollout
  production-ready. Define a user-approved backup and restoration plan or remain in CI.

## Evidence required before owner approval

- Final PR checks `test` and `ephemeral-postgres` both green on the same synthetic
  merge commit, with explicit PR ref provenance.
- Human review of code and release gate rules.
- Tested schema migration forward/rollback in an isolated DB.
- Concurrent ingestion/outbox and write interruption fault injection.
- Price/variant comparison golden dataset; sampled shadow diff report.
- Load/soak benchmark inside confirmed free-tier limits.
- Zero-cost capacity worksheet based on actual provider terms.

**Not authorized:** automatic main merge, production provisioning, applying
branch protection, activating shadow ingestion, modifying customer search, or any
destructive database operation.

## v4.7 connection-attestation boundary (CI-only)

The ephemeral-only entry points now check the **actual connected PostgreSQL
session** before mutating data: `current_database()`, `current_user`,
`session_user`, `inet_server_addr()` and `inet_server_port()`. Standard
`pg` clients also require a local TCP socket peer. A Docker service's server
address can be an RFC1918 private bridge address even when the client reaches
the CI database through localhost:5432. Environment-variable checks alone
are insufficient; injected Pools must pass the read-only session check.

The guard is **not cryptographic remote-server authentication**. A privileged
proxy or malicious synthetic connection could fabricate SQL responses, and
matching database/user names do not constitute independently attested cluster
identity. No production-target connection is permitted in the current V2
code. Production requires a trusted driver and network path, verified TLS
identity/CA when supported, restricted database roles, a migration-only DDL
role, secrets provisioning, a provider-specific target attestation contract,
and explicit owner approval before any feature flag or migration.

In CI, wrong-target test pools connect to the local `postgres` database
instead of `nawaa_ci` while the environment still advertises the permitted
URL. Every V2/Outbox/Backfill entry point must reject that mismatch before
any DDL, receipt, legacy or Outbox write; the test verifies no V2 tables were
created in the wrong database. Savepoint adapters are attested by querying
their transaction owner connection, not by assuming a new Pool selection is safe.

Never remove or weaken the CI-only guard as a shortcut to production.
