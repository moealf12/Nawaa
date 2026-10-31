# R03 — Cache invalidation and concurrency: evidence-verified closure

**Scope:** prevent a revoked expired search-cache snapshot from being republished by `stale-if-error` after a concurrent invalidation; preserve the existing coalescing/replay and R02 completeness rules. This does **not** certify global merchant coverage or production-induced deletion races.

## Code provenance and negative control

- Code PR: https://github.com/moealf12/Nawaa/pull/239
- RED commit: `49fec1ef298e8b58a8035ce73ab3c01d93dee89d`
- RED gate: https://github.com/moealf12/Nawaa/actions/runs/41155127573 — **failed** on the intended regression: the invalidated `deleted` offer resurfaced. This is a genuine failed protected check, not a fabricated failing fixture.
- GREEN head: `33a9cc759102986185990c4ef73ed401a7976fb8`
- Required PR gate: https://github.com/moealf12/Nawaa/actions/runs/41155723743 — PASS
- Extended Search Core: https://github.com/moealf12/Nawaa/actions/runs/41155236892 — PASS
- Merge commit and production revision: `dd96abdc8ec76f4d8730a482fc77762dd9a3b88d`
- Post-merge main release gate: https://github.com/moealf12/Nawaa/actions/runs/41155826932 — PASS
- Render deployment: `dep-dbikbtbm8hqs73eurs1g` — LIVE / succeeded; automated from new main commit.

## Independent real production read-only acceptance

- Run: https://github.com/moealf12/Nawaa/actions/runs/41157104272 — PASS
- Artifact ID: `13025297718` — `nawaa-live-production-source-acceptance-de040aa18b3dd2d172da133a938324132d7c8242`
- Time observed (UTC): 2026-10-31 01:49:54 to 01:52:23.
- Two independent HTTPS `/health` requests returned HTTP 200, `ok:true`, exact revision `dd96abdc8ec76f4d8730a482fc77762dd9a3b88d`.
- 8/8 Arabic/English JSON search queries returned HTTP 200 across smartphone, gaming, audio, computing; 0 invalid published offers.
- 4/4 SSE sessions completed with one done event, zero stream error events, zero malformed final offers, zero unproven FRESH snapshots.
- Repeated PS5 partial query returned `miss/partial`, not a misleading FRESH cache hit.
- Noon routing contained one configured record and no enabled duplicate legacy provider.

## Residual limitations (DO NOT promote to solved)

- **8/8 JSON requests were PARTIAL** with 14–15 reported source errors per request. Valid offers came from several merchants, but this does not certify exhaustive recall or current stock for all providers.
- Single-request JSON sample latencies: 9,938–12,804 ms; repeated PS5 11,232 ms. These are not P50/P95 estimates.
- The actual cache-invalidation race was proved by controlled deterministic RED/GREEN tests, **not** by issuing a destructive deletion to production.
- Completion is limited to R03's revoked-fallback and concurrency scope. Source-stage recovery and broader ranking quality remain future rounds.
