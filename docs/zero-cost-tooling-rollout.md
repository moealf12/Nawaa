# NAWAA — zero-cost tooling (isolated branch)

Development branch: `feature/zero-cost-tooling-foundation`, draft PR #71, based on `phase3-audit-trigger`.

**Non-negotiable:** no new paid services, billing cards, auto-upgrades, production database writes, or changes to `main` and current customer `/api/search`. GitHub-hosted runners use available Actions quota; avoid unnecessary browser CI runs.

## What exists and what is verified

| Component | Implementation | Evidence / limits |
| --- | --- | --- |
| Crawlee + Cheerio | Already installed and used | Existing baseline; no refactor of public search |
| Zod 4.6.5 | `server/tooling/offer-schema.mjs` | Rejects malformed product title, price, currency, HTTPS URL and images |
| p-queue 9.3.3 | `server/tooling/merchant-queue.mjs` | Bounded background concurrency and backpressure; not yet wired to public search |
| pg-boss 12.37.1 | `background-boss.mjs`, `offer-ingestion-worker.mjs`, `certified-ingestion-runtime.mjs` | **Real** ephemeral PostgreSQL 16 integration including retries, immutable observations and ACID deduplication (GitHub Actions run 37967792426) |
| pg_trgm | Opt-in migration and tests | No database extension deployed to production |
| Jina Reader | `server/tooling/jina-reader.mjs` | Allowlisted authenticated optional adapter, mocked tests; no live merchant certification through Jina |
| Crawl4AI 0.9.4 | `scripts/crawl4ai-offline-proof.py` | Chromium + two CSS-extracted products on *local fixture* (GitHub Actions run 37968399348), not a production worker or merchant certification |
| Playwright | `scripts/pilot-browser-check.mjs` | Previously tested 15-source pilot UI; image fallbacks are deliberate when CDN blocks |
| OpenTelemetry API 1.9.1 + SDK 2.12.0 | `server/tooling/local-telemetry.mjs` | Opt-in local spans; **no remote exporter or paid collector**, limited safe source/status attributes |
| Strategy Router | `server/tooling/source-strategy-router.mjs` | Tested selection and fallbacks, **not** connected to customer search |
| Source attestations | `server/tooling/source-attestation.mjs`, `src/certified-source-hosts.mjs` | HMAC-SHA256 binds URL, title, price, currency and images; 15-source domain allowlist and 15-minute TTL |
| Idempotency | `server/persistence.mjs` | Optional transaction receipt ledger; same pg-boss UUID retry does not append duplicate historical observation |

## Important distinction: integrity versus merchant authenticity

An HMAC attestation shows the offer was signed by a trusted NAWAA ingestion process; **it does not prove a merchant actually published that price**. Only the certified extractor can issue a signed observation after checking the original merchant data, the URL, currency and image. The unsigned queue flag `verifiedBySource` is not enough.

The producer requires an attestation. The worker verifies its signature using an environment-only signing key and the exact approved source-domain list. Retries reuse a UUID, and a transactional receipt ensures at-most-once insertion for each ID even after a crash between commit and acknowledgement. This deliberately does **not** deduplicate unrelated new observations across different jobs.

## Operational flags

- `NAWAA_ENABLE_BACKGROUND_JOBS=1` allows pg-boss and creates its receipt ledger.
- `NAWAA_ENABLE_CERTIFIED_INGESTION=1` additionally enables the 15-source worker via **explicit invocation only**.
- `NAWAA_INGESTION_SIGNING_KEY`: a distinct, private random secret at least 32 bytes. Never commit it.
- `NAWAA_LOCAL_TELEMETRY=1`: enables local OpenTelemetry console spans; remains disabled by default.
- `NAWAA_ENABLE_TRIGRAM_MIGRATION=1`: one-time pg_trgm migration only when explicitly executed, not on startup.
- `JINA_API_KEY`: external service key, optional; never log or commit it.

## Still outstanding before deployment

1. Connect certified live source extractors to the attestation issuer after original-merchant verification. Current pg-boss DB integration uses an isolated **CI fixture**, not scraped live offers.
2. Safely configure database credentials/quotas and signing key for a dedicated zero-cost background worker; test on a disposable non-production database again.
3. Evaluate Crawl4AI on a *consented/allowed* real source and measure memory and browser CPU. The local fixture is not a live source certification.
4. Expand browser QA, source observation monitoring and production-readiness/security review.
5. Keep the original 15-source preview separated from PR #71, and keep the remaining 24 unapproved pending independent live certification.

No automatic rollout or production migration is authorized by these tests.
