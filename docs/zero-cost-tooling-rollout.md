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

1. Connect certified live source extractors to the attestation issuer after original-merchant verification. The initial pg-boss integration used an isolated **CI fixture**. Later disposable-database runs additionally verified five real IKEA offers with merchant HTML price parity. No production writing is enabled.
2. Safely configure database credentials/quotas and signing key for a dedicated zero-cost background worker; test on a disposable non-production database again.
3. Evaluate Crawl4AI on a *consented/allowed* real source and measure memory and browser CPU. The local fixture is not a live source certification.
4. Expand browser QA, source observation monitoring and production-readiness/security review.
5. Keep the original 15-source preview separated from PR #71, and keep the remaining 24 unapproved pending independent live certification.

No automatic rollout or production migration is authorized by these tests.


## Pilot merchant-original producer (IKEA Saudi only)

- \`server/tooling/merchant-observation-producer.mjs\` is a new **explicitly invoked** producer. It accepts an IKEA Saudi product page URL, uses the existing DNS-pinned, redirect-validated and byte-limited extraction transport, and inspects a unique JSON-LD Product with a single exact Offer.
- Fails closed on redirects changing product paths, unapproved merchant hosts, non-SAR prices, missing/ambiguous price evidence, multi-offer variants and unapproved source IDs. A pilot-certified domain is not by itself permission to run this live producer.
- \`scripts/probe-certified-merchant.mjs <IKEA_SA_PRODUCT_URL>\` is read-only. It requires **no secret, database or queue** and produces evidence plus image presence. Live store behavior is not asserted by the offline tests.
- \`enqueueCertifiedMerchantProduct(...)\` issues the original-source HMAC only after successful inspection and hands the exact observed product to pg-boss; it is not executed at HTTP startup. A valid signature remains proof of *trusted producer issuance*, not independent proof against a compromised merchant or extractor.
- Worker persists only fields bound by v1 attestation plus controlled source/receipt metadata and **uses the verified HMAC-issued timestamp as the observation time**. Unsigned job fields such as \`observedAt\`, \`healthStatus\`, \`totalSAR\` and \`brand\` are discarded. Older signed deliveries cannot overwrite newer canonical prices.
- Still no automated crawling, production credentials, production writes, broader merchant activation, or customer search change. The single-source read-only probe, five-product visible HTML price proof and five-offer disposable PostgreSQL ingestion have since completed. No scheduled production crawler is active.


## October 9, 2026: tested live and historical gates

This checkpoint supersedes older planned steps above.

- Five IKEA Saudi offers passed real merchant URL, SKU, image, HMAC, independently parsed HTML price and ephemeral PostgreSQL ingestion checks. See [five-offer integration](https://github.com/moealf12/Nawaa/actions/runs/37987509336).
- The history lifecycle passed with one authentic observed 479 SAR price and a controlled simulated 489 SAR change; the simulated amount is **not a real merchant observation**. An older backdated record stayed historical and did not overwrite the current canonical row. See [history lifecycle](https://github.com/moealf12/Nawaa/actions/runs/37988162703).
- Internal getOfferPriceHistory supports bounded chronological queries scoped to source and product. See [history query checks](https://github.com/moealf12/Nawaa/actions/runs/37988432920).
- Further work: verify real price changes across days, variant/browser rendering, source-rate budgets, and deployment controls. The live consumer search and production DB remain untouched.

## October 10, 2026: signed ordering, concurrency and bounded price history

**Evidence-based latest status** (all prices in synthetic lifecycle tests are fixtures, *not* observed IKEA changes):

- Signed observation order tested on an actual disposable PostgreSQL 16 worker path: [signed out-of-order run](https://github.com/moealf12/Nawaa/actions/runs/38002893563).
- 12 distinct signed observations for the same SKU were processed with 13 parallel calls and two simultaneous retries. The [concurrency test](https://github.com/moealf12/Nawaa/actions/runs/38004351159) passed: one canonical offer, 12 immutable observations, 12 receipts, no stale overwrite.
- `getOfferPriceHistory` now additionally includes `insights` via the pure internal module `server/tooling/price-history-insights.mjs`: last different price, bounded-sample minimum and maximum, direction, observed percentage change, and a marked >=10% move. Invalid or mixed-currency histories do not produce discounts.
- Repeated unchanged latest readings do **not** create a new historical low if that price previously occurred before a rebound. Source data sample bounds are explicit; these flags are not all-time-price guarantees.
- [Historical prices on disposable PostgreSQL](https://github.com/moealf12/Nawaa/actions/runs/38004634849) validate the read model, immutable history and synthetic descending price fixture.
- `main`, public search, production database and production signing keys are untouched. No production ingestion permissions are implied by any passing CI check.

**Remaining gates:** verify real multi-day source refresh without hitting merchant limits; decide acceptable stale-price age, source rate budget, retry/backoff and alerting; retain independently verified merchant DOM price checks; evaluate deployment isolation before adding scheduling.

## October 10, 2026: opt-in budgeted explicit source refresh

Implementation stays confined to `feature/zero-cost-tooling-foundation`; no production customer search change or scheduled crawler.

- `server/tooling/source-refresh-policy.mjs`: **read-only** admission plan for IKEA Saudi with a 6-hour revisit floor, 48-hour stale classification, up to five known pilot products per run, two estimated page requests per product, and a 10-request/24-hour planning budget. Handles failures, Retry-After deadlines, 403/404 manual review and invalid timestamps.
- `server/tooling/durable-refresh-budget.mjs`: feature-flagged PostgreSQL **transactional request reservations**, max 10 permitted IKEA GETs per 24-hour source window. Each reservation is charged **before** fetching and never refunded. An atomic per-SKU six-hour attempt lease blocks concurrent duplicate refreshes without charging the rejected attempt. No schema is created when the flags are disabled.
- `server/tooling/explicit-ikea-refresh.mjs`: an **explicitly invoked** single-product bridge using only the five approved URLs, protected by separate background, certification, budget and explicit-refresh flags. It verifies existing observation age, reserves the SKU lease and two requests in one transaction, extracts the merchant JSON-LD and separately verifies the customer-facing HTML price, signs with HMAC and queues to pg-boss.
- `fetchHtmlSafe` gained an **opt-in `maxRedirects:0`** argument. The explicit bridge uses this on both page GETs: redirects are rejected instead of silently consuming additional network requests. Existing callers retain unchanged default redirect behavior.
- [Offline refresh planner proof](https://github.com/moealf12/Nawaa/actions/runs/38005183957) **passed** with no network requests or database writes.
- [Atomic PostgreSQL source quota proof](https://github.com/moealf12/Nawaa/actions/runs/38005718883) **passed** with seven concurrent source reservations and same-SKU lease tests on a disposable database.
- [Actual authorized single-product refresh proof](https://github.com/moealf12/Nawaa/actions/runs/38005815483) **passed**: the merchant showed SAR 479 for SKU 39240787, HTML and JSON-LD agreed, exactly two requests were reserved, one signed offer/history/receipt was stored on disposable PostgreSQL, a second simultaneous refresh of the same SKU was **blocked without another charge**, and a subsequent fresh-price recheck was skipped.

Safeguards and remaining limits: no automatic schedule, no public API, no credentials stored in source, no production database writes, and no claim of multi-day real price stability. Merchant robots/terms, permitted acquisition frequencies, dynamic checkout/region pricing, production failover, and monitoring still require review before deployment.


## October 10, 2026 — offline health monitoring and source-certification caveat

- `server/tooling/pilot-health-monitor.mjs` assesses the five explicitly approved IKEA Saudi SKUs using bounded, read-only observation histories. It emits `fresh`, `aging`, `stale`, `history_unavailable`, and `invalid_observations` statuses. No automatic notifications or scheduled jobs are enabled.
- A historical price move is only marked confirmed *within the observed sample* when independent daily samples are available, with at least two distinct UTC calendar days; a single reading or same-day variation cannot establish a confirmed multi-day drop. The report does not assert an all-time or market-wide low. Large sample movements (at least 10% versus the previous day's observed sample) become local report flags, not production alerts.
- [Offline health test run 38006450711](https://github.com/moealf12/Nawaa/actions/runs/38006450711): **9/9 passed**, using synthetic fixtures, zero merchant requests, zero production writes.
- **Separate known source-health problem:** [39-source certification run 38005914611](https://github.com/moealf12/Nawaa/actions/runs/38005914611) **failed**. Multiple merchants returned 403, timeouts, absent valid candidates or missing images. The presence of a configured source is **not** proof of verified live price coverage; do not label all 39 as production certified or attempt to evade merchant blocks. Track each merchant's actual certification outcome before any activation.
