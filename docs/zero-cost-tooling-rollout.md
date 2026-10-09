# Zero-cost tooling rollout (isolated branch)

Base: `phase3-audit-trigger`; protect the 15-certified-source pilot, public `main`, and live customer search.

No subscriptions, paid instances, credits with auto-upgrade, secret values in Git, or unapproved Render upgrades.

## Progress

- [x] Isolated feature branch created.
- [x] PostgreSQL `pg_trgm` opt-in migration + unit tests. **Not run against any remote database.**
- [ ] Install and integrate **Zod**; the isolated offer-shape gate is temporary and does not claim to be Zod. Update npm lockfile and tests together.
- [x] Implement **dependency-free, background-only** per-merchant concurrency queue, validated offer shape, and Retry-After/backoff helpers with tests. These are not connected to customer search.\n- [ ] Install and integrate the requested **p-queue** library after lockfile update; current custom limiter is only an isolated prototype.
- [ ] Add pg-boss background ingestion with DB migration compatibility verification.
- [ ] Crawl4AI separate-worker proof of concept: check free RAM/CPU limits first.
- [ ] Playwright end-to-end tests for the pilot and image fallbacks.
- [ ] OpenTelemetry lightweight observability; no paid collector.
- [ ] Keep Crawlee + Cheerio as current baseline.

## Deployment guardrails

The trigram DDL is **opt-in only**: run `node scripts/enable-trigram.mjs` with `NAWAA_ENABLE_TRIGRAM_MIGRATION=1` and an approved `DATABASE_URL`. It is not run during startup. DB provider must support `pg_trgm`; no migration should run on production without approval and backup.

All new extractors are background-only until their quality, relevance and cost tests pass. A green unit test does not imply merchant certification or production readiness.
